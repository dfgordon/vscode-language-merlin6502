import * as vsserv from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import { DiagnosticSet } from './diagnostics';
import { MerlinContext } from './workspace';

const MAX_MACRO_LINES = 100;

function Defined(name: string, map: Map<string, LabelNode[]>): boolean
{
	const lnodes = map.get(name);
	if (!lnodes)
		return false;
	return lnodes[0].definedAnywhere;
}

export function AddLabel(txt: string,lnode: LabelNode,map: Map<string,Array<LabelNode>>)
{
	let lnodes = map.get(txt);
	if (!lnodes) {
		lnodes = new Array<LabelNode>();
		map.set(txt, lnodes);
	}
	lnodes.push(lnode);
	if (lnode.isDef && !lnodes[0].definedAnywhere)
		for (const node of lnodes)
			node.definedAnywhere = true;
	if (lnode.isSub && !lnodes[0].isSub)
		for (const node of lnodes)
			node.isSub = true;
	lnode.definedAnywhere = lnodes[0].definedAnywhere;
	lnode.isSub = lnodes[0].isSub;
}

export class ChildLabel
{
	loc: vsserv.Location;
	name: string;
	constructor(uri: string, rng: vsserv.Range, name: string) {
		this.loc = vsserv.Location.create(uri, rng);
		this.name = name;
	}
}

export class LabelNode
{
	doc: vsserv.TextDocumentItem;
	rng: vsserv.Range;
    isEntry: boolean;
	isExternal: boolean;
	isDec: boolean;
    isDef: boolean;
	isRef: boolean;
	isSub: boolean;
	value: number | undefined;
	definedAnywhere: boolean;
	children: ChildLabel[];
	macro_txt: string;
	parse_merlin_number(num_str:string) : number
	{
		if (num_str[0]=='$')
			return parseInt(num_str.substring(1),16);
		if (num_str[0]=='%')
			return parseInt(num_str.substring(1),2);
		return parseInt(num_str);
	}
	constructor(doc: vsserv.TextDocumentItem, node: Parser.SyntaxNode, rng: vsserv.Range) {
		const next = node.nextNamedSibling;
		const parent = node.parent;
		this.doc = doc;
		this.rng = rng;
		this.isEntry = false;
		this.isExternal = false;
		this.isSub = false;
		if (next?.type == "psop_equ") {
			const valNode = next.nextNamedSibling?.firstNamedChild;
			if (valNode?.type == "num")
				this.value = this.parse_merlin_number(valNode.text);
			if (this.value && isNaN(this.value))
				this.value = undefined;
		}
		if (parent && parent.type == "arg_ent" || next && next.type == "psop_ent")
			this.isEntry = true;
		if (parent && parent.type == "arg_ext" || next && next.type == "psop_ext")
			this.isExternal = true;
		if (parent && parent.type == "arg_exd" || next && next.type == "psop_exd")
			this.isExternal = true;
		if (node.type == "label_ref" && parent?.parent?.previousNamedSibling?.type == "op_jsr")
			this.isSub = true;
		this.isDec = this.isExternal || this.isEntry;
		this.isDef = node.type == "label_def" || node.type == "macro_def";
		this.isRef = node.type == "label_ref" || node.type == "macro_ref";
		this.definedAnywhere = this.isDef; // to be updated externally
		this.children = []; // to be updated externally
		this.macro_txt = "";
		// if this is a macro def lookahead and save the code
		if (node.type == "macro_def") {
			const lines = doc.text.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				if (i >= MAX_MACRO_LINES)
					break;
				let line = lines[rng.start.line + i];
				this.macro_txt += line + '\n';
				if (/^\S*\s+EOM/i.test(line) || /^\S*\s+<<</.test(line))
					break;
			}
		}
	}
}

/** Map each label name to an array of nodes.
 * The node array can be drawn from multiple documents (master and includes).
 */
export class LabelSet
{
	globals = new Map<string,Array<LabelNode>>();
	locals = new Map<string,Array<LabelNode>>();
	vars = new Map<string,Array<LabelNode>>();
	macros = new Map<string, Array<LabelNode>>();
	macro_locals = new Map<string, Array<LabelNode>>();
	macro_locals_pos = new Map<number,string>();
}

export class LabelSentry
{
	context: MerlinContext;
	/** Map from documents to diagnostic arrays.  The involved documents are a master and its includes */
	diag: DiagnosticSet;
	/** temporary while building labels for a master document */
	private labels = new LabelSet();
	/** label sets for all master documents, mapped by uri */
	shared = new Map<string,LabelSet>();
	runningMacros = new Set<string>();
	runningVars = new Set<string>();
	inMacro = false;
	currMacroName = '';
	currMacroNode: LabelNode | undefined;
	currScopeName = '';
	currScopeNode: LabelNode | undefined;
	constructor(ctx: MerlinContext, diag: DiagnosticSet)
	{
		this.context = ctx;
		this.diag = diag;
	}
	find_label(currDoc: vsserv.TextDocumentItem, rng: vsserv.Range, ary: Array<LabelNode>) : number
	{
		if (ary) {
			for (let i = 0; i < ary.length; i++) {
				if (ary[i].doc.uri == currDoc.uri && lxbase.rangeContainsRange(rng, ary[i].rng)) {
					return i;
				}
			}
		}
		return -1;
	}
	remove_label(txt: string, currDoc: vsserv.TextDocumentItem, rng: vsserv.Range, map: Map<string, Array<LabelNode>>)
	{
		let ary = map.get(txt);
		if (!ary)
			return;
		let i = this.find_label(currDoc, rng, ary);
		if (i>=0) {
			let last = ary.pop();
			if (last && ary.length>i)
				ary[i] = last;
		}
	}
	/**
	 * Substitute macro variables with arguments
	 * @param txt text of the entire macro
	 * @param nodes list of macro arguments
	 * @returns [expanded macro, set of variables that were actually used]
	 */
	substitute_vars(txt: string, nodes: Parser.SyntaxNode[]): [string,Set<number>] {
		let ans = '';
		let find = new Array<string>();
		let types = new Array<string>();
		let repl = new Array<string>();
		let matches = new Set<number>();
		for (let i = 0; i < nodes.length; i++) {
			find.push(']' + (i + 1).toString());
			types.push('var_mac');
			repl.push(nodes[i].text);
		}
		// Search also for things that were not provided, but could be required,
		// if found all that happens is it goes into the returned matches.
		for (let i = nodes.length; i < 8; i++) {
			find.push(']' + (i + 1).toString());
			types.push('var_mac');
			repl.push(']' + (i + 1).toString());
		}
		for (const line of txt.split(/\r?\n/)) {
			const [ln,partial] = this.context.Substitute(line, this.runningMacros, find, types, repl);
			ans += ln + "\n";
			for (const match of partial) {
				matches.add(match);
			}
		}
		for (let i = 0; i < nodes.length; i++) {
			if (!matches.has(i)) {
				const rng = lxbase.node_to_range(nodes[i], this.context.row, this.context.col);
				this.diag.add(vsserv.Diagnostic.create(rng, 'argument not used',vsserv.DiagnosticSeverity.Warning));
			}
		}
		return [ans, matches]
	}
	/**
	 * Recursively expand a macro reference using the arguments
	 * @param node macro reference node to expand
	 * @param ans starting result (TODO, use for recursion?)
	 */
	expand_macro(node: Parser.SyntaxNode, ans: string) : string | null {
		if (node.type != 'macro_ref') {
			this.context.logger.log('expand: wrong node type');
			return null;
		}
		let def = this.labels.macros.get(node.text);
		if (!def || def.length==0) {
			this.context.logger.log('expand: no def');
			return null;
		}
		let def_node = def[0];
		let next = node.nextNamedSibling;
		let matches = new Set<number>();
		let arg_count = 0;
		if (next?.type == 'arg_macro') {
			arg_count = next?.namedChildCount;
			[ans, matches] = this.substitute_vars(def_node.macro_txt, next?.namedChildren);
		} else {
			[ans, matches] = this.substitute_vars(def_node.macro_txt, []);
		}
		for (let i = arg_count; i < 8; i++) {
			if (matches.has(i)) {
				const rng = lxbase.node_to_range(node, this.context.row, this.context.col);
				this.diag.add(vsserv.Diagnostic.create(rng, 'argument missing: `]'+(i+1).toString()+'`'));
			}
		}
		return ans;
	}
	/**
	 * visit function to gather labels in a first pass
	 * @param curs cursor for the syntax tree of the document being analyzed
     */
	visit_gather(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		if (!this.context)
			return lxbase.WalkerOptions.gotoChild;
		const currDoc = this.context.stack.doc[this.context.stack.doc.length - 1]
		const currCtx = this.context.stack.ctx[this.context.stack.ctx.length - 1];
		const rng = lxbase.curs_to_range(curs, this.context.row, this.context.col);
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		this.diag.set_doc(currDoc);
		if (child && curr.type == 'macro_def')
		{
			const lnode = new LabelNode(currDoc, curr, rng);
			if (child.type=='global_label')
			{
				if (this.context.stack.ctx[this.context.stack.ctx.length-1]==lxbase.SourceOptions.put)
					this.diag.add(vsserv.Diagnostic.create(rng,'macros are not allowed in PUT files'));
				if (child.text.match(this.context.opExactPattern) || child.text.match(this.context.psopExactPattern))
					this.diag.add(vsserv.Diagnostic.create(rng,'macro name matches a mnemonic',vsserv.DiagnosticSeverity.Warning));
				if (Defined(child.text,this.labels.macros))
					this.diag.add(vsserv.Diagnostic.create(rng,'redefinition of a macro',vsserv.DiagnosticSeverity.Error));
				if (Defined(child.text,this.labels.globals))
					this.diag.add(vsserv.Diagnostic.create(rng,'macro name is used previously as a label',vsserv.DiagnosticSeverity.Error));
				AddLabel(child.text, lnode, this.labels.macros);
				this.inMacro = true;
				this.currMacroName = curr.text;
				this.currMacroNode = lnode;
				this.runningMacros.add(curr.text); // needed to capture macro_ref nodes that collide, like `inc16`
			}			
			else
			{
				this.diag.add(vsserv.Diagnostic.create(rng,'macro label needs to be global',vsserv.DiagnosticSeverity.Error));
			}
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (curr.type=='psop_eom')
		{
			this.inMacro = false;
			this.currMacroName = '';
			this.currMacroNode = undefined;
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (child && curr.type=='label_def')
		{
			const lnode = new LabelNode(currDoc, curr, rng);
			if (child.type == 'global_label' && !this.inMacro) {
				if (Defined(child.text, this.labels.globals))
					this.diag.add(vsserv.Diagnostic.create(rng, 'redefinition of a global label', vsserv.DiagnosticSeverity.Error));
				if (Defined(child.text, this.labels.macros))
					this.diag.add(vsserv.Diagnostic.create(rng, 'label name is used previously as a macro'))
				AddLabel(child.text, lnode, this.labels.globals);
				this.currScopeName = child.text;
				this.currScopeNode = lnode;
			}
			else if (child.type == 'global_label' && this.inMacro) {
				const xName = this.currMacroName + '\u0100' + child.text;
				if (Defined(xName, this.labels.macro_locals))
					this.diag.add(vsserv.Diagnostic.create(rng, 'redefinition of a macro scoped label', vsserv.DiagnosticSeverity.Warning));
				AddLabel(xName, lnode, this.labels.macro_locals);
				this.labels.macro_locals_pos.set(1000*rng.start.line + rng.start.character,this.currMacroName);
				if (this.currMacroNode && this.currMacroNode.doc.uri == currDoc.uri)
					this.currMacroNode.children.push(new ChildLabel(currDoc.uri, lnode.rng, child.text));
			}
			else if (child.type == 'local_label') {
				const xName = this.currScopeName + '\u0100' + child.text;
				if (Defined(xName, this.labels.locals))
					this.diag.add(vsserv.Diagnostic.create(rng, 'redefinition of a local label', vsserv.DiagnosticSeverity.Error));
				AddLabel(xName, lnode, this.labels.locals);
				if (this.currScopeNode && this.currScopeNode.doc.uri == currDoc.uri)
					this.currScopeNode.children.push(new ChildLabel(currDoc.uri, lnode.rng, child.text));
			}
			else if (child.type == 'var_label') {
				if (child.firstNamedChild?.type=='var_mac')
					this.diag.add(vsserv.Diagnostic.create(rng, 'macro substitution variable cannot label a line', vsserv.DiagnosticSeverity.Error));
				else if (child.firstNamedChild?.type=='var_cnt' && this.context.merlinVersion!='v8')
					this.diag.add(vsserv.Diagnostic.create(rng, 'argument count cannot label a line', vsserv.DiagnosticSeverity.Error));
				else
					AddLabel(child.text, lnode, this.labels.vars);
			}
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (child && curr.type == 'macro_ref')
		{
            const lnode = new LabelNode(currDoc,curr,rng);
			if (child.type=='global_label')
				AddLabel(child.text,lnode,this.labels.macros);
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (child && curr.type == 'label_ref')
		{
            const lnode = new LabelNode(currDoc,curr,rng);
			if (child.type == 'global_label') {
				// at this point defer interpretation as macro local or true global
				AddLabel(child.text, lnode, this.labels.globals);
			}
			else if (child.type=='local_label') {
				const xName = this.currScopeName + '\u0100' + child.text;
				AddLabel(xName,lnode,this.labels.locals);
			}
			else if (child.type=='var_label')
				AddLabel(child.text,lnode,this.labels.vars);
			return lxbase.WalkerOptions.gotoSibling;
		}
		if ((curr.type == 'psop_put' || curr.type == 'psop_use') && currCtx==lxbase.SourceOptions.master)
			return lxbase.WalkerOptions.gotoInclude;
		return lxbase.WalkerOptions.gotoChild;
	}
	/** add diagnostics for file not found or multiple matches */
	verify_include_path(curs: Parser.TreeCursor,currDoc: vsserv.TextDocumentItem)
	{
		if (!this.context)
			return;
		const path_node = curs.currentNode().nextNamedSibling;
		if (path_node) {
			const rng = lxbase.node_to_range(path_node, this.context.row, this.context.col);
			const num = this.context.include_candidates(curs);
			if (num == 0)
				this.diag.add( vsserv.Diagnostic.create(rng, 'file not found in workspace', vsserv.DiagnosticSeverity.Error));
			if (num > 1)
				this.diag.add(vsserv.Diagnostic.create(rng, 'multiple matches ('+num+') exist in the workspace', vsserv.DiagnosticSeverity.Error));
		}
	}
	/**
	 * Verify all labels after they have been gathered.
	 * @param curs cursor for the syntax tree of the document being analyzed
	 */
	visit_verify(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		if (!this.context)
			return lxbase.WalkerOptions.gotoChild;
		const currDoc = this.context.stack.doc[this.context.stack.doc.length - 1];
		const currCtx = this.context.stack.ctx[this.context.stack.ctx.length - 1];
		const rng = lxbase.curs_to_range(curs, this.context.row, this.context.col);
		const macroAverse = ['psop_ent','psop_ext','psop_exd','psop_put','psop_use','psop_sav'];
		const curr = curs.currentNode();
		const child = curr.firstChild;
		this.diag.set_doc(currDoc);
		if (child && curr.type=='label_ref')
		{
			const localLabelExt = this.currScopeName + '\u0100' + curr.text;
			const macroLocalExt = this.currMacroName + '\u0100' + curr.text;
			if (child.type=='global_label' && Defined(curr.text,this.labels.macros))
				this.diag.add(vsserv.Diagnostic.create(rng,'macro cannot be used here',vsserv.DiagnosticSeverity.Error));
			else if (child.type == 'global_label') {
				if (Defined(macroLocalExt, this.labels.macro_locals)) {
					this.remove_label(curr.text, currDoc, rng, this.labels.globals);
					AddLabel(macroLocalExt, new LabelNode(currDoc, curr, rng), this.labels.macro_locals);
					this.labels.macro_locals_pos.set(1000*rng.start.line + rng.start.character,this.currMacroName);
				}
				else if (!Defined(curr.text, this.labels.globals))
					this.diag.add(vsserv.Diagnostic.create(rng, 'global label is undefined', vsserv.DiagnosticSeverity.Error));
			}
			else if (child.type=='local_label' && !Defined(localLabelExt,this.labels.locals))
				this.diag.add(vsserv.Diagnostic.create(rng,'local label is not defined in this scope',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && this.inMacro)
				this.diag.add(vsserv.Diagnostic.create(rng, 'cannot use local labels in a macro', vsserv.DiagnosticSeverity.Error));
			else if (child.type == 'var_label') {
				if (child.firstNamedChild?.type == 'var_mac' && this.inMacro)
					return lxbase.WalkerOptions.gotoSibling;
				else if (child.firstNamedChild?.type == 'var_cnt' && this.context.merlinVersion!='v8' && this.inMacro)
					return lxbase.WalkerOptions.gotoSibling;
				else if (child.firstNamedChild?.type=='var_mac' && !this.inMacro)
					this.diag.add(vsserv.Diagnostic.create(rng, 'macro substitution variable referenced outside macro', vsserv.DiagnosticSeverity.Error));
				else if (child.firstNamedChild?.type=='var_cnt' && this.context.merlinVersion!='v8' && !this.inMacro)
					this.diag.add(vsserv.Diagnostic.create(rng, 'argument count referenced outside macro', vsserv.DiagnosticSeverity.Error));
				else if (child.type == 'var_label' && !Defined(curr.text,this.labels.vars))
					this.diag.add(vsserv.Diagnostic.create(rng,'variable is undefined',vsserv.DiagnosticSeverity.Error));
				else if (child.type == 'var_label' && !this.runningVars.has(curr.text))
					this.diag.add(vsserv.Diagnostic.create(rng,'variable is forward referenced',vsserv.DiagnosticSeverity.Warning));
			}
			return lxbase.WalkerOptions.gotoSibling
		}
		// handle `var_mac` occurrences that have no `var_label` parent
		else if (curr.type == 'var_mac' && !this.inMacro)
		{
			this.diag.add(vsserv.Diagnostic.create(rng, 'macro substitution variable referenced outside macro', vsserv.DiagnosticSeverity.Error));
		}
		else if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
				this.currScopeName = curr.text;
			else if (child.type=='local_label')
			{
				if (this.currScopeName=='')
					this.diag.add(vsserv.Diagnostic.create(rng,'no global scope defined yet',vsserv.DiagnosticSeverity.Error));
				const next = curr.nextNamedSibling;
				if (next && (next.type=='psop_mac' || next.type=='psop_ent' || next.type=='psop_ext' || next.type=='psop_equ'))
					this.diag.add(vsserv.Diagnostic.create(rng,'cannot use local label for ' + next.text,vsserv.DiagnosticSeverity.Error));
				if (this.inMacro)
					this.diag.add(vsserv.Diagnostic.create(rng,'cannot use local labels in a macro',vsserv.DiagnosticSeverity.Error));
			}
			else if (child.type=='var_label') // no harm in adding mac args too
				this.runningVars.add(curr.text);
			return lxbase.WalkerOptions.gotoSibling
		}
		else if (curr.type=='macro_def')
		{
			this.runningMacros.add(curr.text);
			this.currMacroName = curr.text;
			this.inMacro = true;
		}
		else if (curr.type=='macro_ref')
		{
			if (!Defined(curr.text,this.labels.macros) && Defined(curr.text,this.labels.globals))
				this.diag.add(vsserv.Diagnostic.create(rng,'expected macro, this is a label',vsserv.DiagnosticSeverity.Error));
			else if (!Defined(curr.text,this.labels.macros))
				this.diag.add(vsserv.Diagnostic.create(rng,'macro is undefined',vsserv.DiagnosticSeverity.Error));
			else if (!this.runningMacros.has(curr.text))
				this.diag.add(vsserv.Diagnostic.create(rng, 'macro is forward referenced', vsserv.DiagnosticSeverity.Error));
			else {
				// TODO: treat macro expansion as a descent document like the includes,
				// but with a buffer-like URI
				let nodes = this.labels.macros.get(curr.text);
				if (nodes) {
					let node = this.find_label(currDoc, rng, nodes);
					if (node >= 0) {
						const xp = this.expand_macro(curr, '');
						nodes[node].macro_txt = xp ? xp : 'cannot expand';
					}
				}
			}
		}
		else if (curr.type == "psop_use" || curr.type == "psop_put")
		{
			const psop = curr.type.substring(5, 8).toUpperCase();
			this.verify_include_path(curs, currDoc);
			if (currCtx != lxbase.SourceOptions.master)
				this.diag.add(vsserv.Diagnostic.create(rng, 'recursive '+psop+' is not allowed', vsserv.DiagnosticSeverity.Error));
			else
				return lxbase.WalkerOptions.gotoInclude;
		}
		else if (this.inMacro && macroAverse.includes(curr.type))
			this.diag.add(vsserv.Diagnostic.create(rng,'pseudo operation cannot be used in a macro',vsserv.DiagnosticSeverity.Error));
		else if (curr.type=='psop_eom')
		{
			if (this.inMacro==false)
				this.diag.add(vsserv.Diagnostic.create(rng,'unmatched end of macro (EOM terminates all preceding MAC pseudo-ops)',vsserv.DiagnosticSeverity.Error));
				this.currMacroName = '';
				this.inMacro = false;
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	/**
	 * build the label set associated with a master document
	 * @param document this can be the document being displayed, if not a master, the master will be found
	 */
	build_main(document: vsserv.TextDocumentItem,ctx: MerlinContext)
	{
		this.context = ctx;
		this.labels = new LabelSet();
		this.runningMacros = new Set<string>();
		this.runningVars = new Set<string>();
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		this.currMacroName = '';
		this.currMacroNode = undefined;
		this.diag = new DiagnosticSet;
		this.context.analyze(document, this.runningMacros, this.visit_gather.bind(this));
	}
	/**
	 * verify the label set associated with a document, assumes label set has been built
	 * @param document this can be the document being displayed, if not a master, the master will be found
	 */
	verify_main(document: vsserv.TextDocumentItem,ctx: MerlinContext)
	{
		this.context = ctx;
		this.runningMacros = new Set<string>();
		this.runningVars = new Set<string>();
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		this.currMacroName = '';
		this.currMacroNode = undefined;
		this.context.analyze(document, this.runningMacros, this.visit_verify.bind(this));
		// correlate EXT and ENT
		for (const [lbl, lst] of this.labels.globals)
			for (const lnode of lst)
				if (lnode.isExternal && !this.context.entries.has(lbl)) {
					this.diag.set_doc(lnode.doc);
					this.diag.add(vsserv.Diagnostic.create(lnode.rng, 'no corresponding entry was found in the workspace', vsserv.DiagnosticSeverity.Warning));
				}
	}
	/** attach label set to document, makes private label set available */
	attach(uri: string) {
		this.shared.set(uri, this.labels);
	}
}
