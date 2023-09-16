import * as vsserv from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import { DiagnosticSet } from './diagnostics';
import { MerlinContext } from './workspace';
import { merlin6502Settings } from './settings';

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
	parse_merlin_number(num_str:string) : number
	{
		if (num_str[0]=='$')
			return parseInt(num_str.substring(1),16);
		if (num_str[0]=='%')
			return parseInt(num_str.substring(1),2);
		return parseInt(num_str);
	}
	constructor(doc: vsserv.TextDocumentItem, node: Parser.SyntaxNode, rng: vsserv.Range)
	{
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
	macros = new Map<string,Array<LabelNode>>();
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
	running = new Set<string>();
	inMacro = false;
	currScopeName = '';
	currScopeNode: LabelNode | undefined;
	constructor(ctx: MerlinContext, diag: DiagnosticSet)
	{
		this.context = ctx;
		this.diag = diag;
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
			}			
			else
			{
				this.diag.add(vsserv.Diagnostic.create(rng,'macro label needs to be global',vsserv.DiagnosticSeverity.Error));
			}
		}
		if (child && curr.type=='label_def')
		{
			const lnode = new LabelNode(currDoc, curr, rng);
			if (child.type=='global_label')
			{
				if (Defined(child.text,this.labels.globals))
					this.diag.add(vsserv.Diagnostic.create(rng,'redefinition of a global label',vsserv.DiagnosticSeverity.Error));
				if (Defined(child.text,this.labels.macros))
					this.diag.add(vsserv.Diagnostic.create(rng,'label name is used previously as a macro'))
				AddLabel(child.text, lnode, this.labels.globals);
				this.currScopeName = child.text;
				this.currScopeNode = lnode;
			}
			else if (child.type=='local_label')
			{
				const xName = this.currScopeName + '\u0100' + child.text;
				if (Defined(xName,this.labels.locals))
					this.diag.add(vsserv.Diagnostic.create(rng,'redefinition of a local label',vsserv.DiagnosticSeverity.Error));
				AddLabel(xName, lnode, this.labels.locals);
				if (this.currScopeNode && this.currScopeNode.doc.uri==currDoc.uri)
					this.currScopeNode.children.push(new ChildLabel(currDoc.uri,lnode.rng,child.text));
			}
			else if (child.type=='var_label')
			{
				AddLabel(child.text,lnode,this.labels.vars);
			}
		}
		if (child && curr.type == 'macro_ref')
		{
            const lnode = new LabelNode(currDoc,curr,rng);
			if (child.type=='global_label')
				AddLabel(child.text,lnode,this.labels.macros);
		}
		if (child && curr.type == 'label_ref')
		{
            const lnode = new LabelNode(currDoc,curr,rng);
			if (child.type=='global_label')
				AddLabel(child.text,lnode,this.labels.globals);
			else if (child.type=='local_label') {
				const xName = this.currScopeName + '\u0100' + child.text;
				AddLabel(xName,lnode,this.labels.locals);
			}
			else if (child.type=='var_label')
				AddLabel(child.text,lnode,this.labels.vars);
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
		const is_var = (child && child.type=='var_label') && (![...'123456789'].includes(curr.text[1]) || curr.text.length>2);
		const localLabelExt = this.currScopeName + '\u0100' + curr.text;
		this.diag.set_doc(currDoc);
		if (child && curr.type=='label_ref')
		{
			if (child.type=='global_label' && Defined(curr.text,this.labels.macros))
				this.diag.add(vsserv.Diagnostic.create(rng,'macro cannot be used here',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='global_label' && !Defined(curr.text,this.labels.globals))
				this.diag.add(vsserv.Diagnostic.create(rng,'global label is undefined',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && !Defined(localLabelExt,this.labels.locals))
				this.diag.add(vsserv.Diagnostic.create(rng,'local label is not defined in this scope',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && this.inMacro)
				this.diag.add(vsserv.Diagnostic.create(rng,'cannot use local labels in a macro',vsserv.DiagnosticSeverity.Error));
			else if (is_var && !Defined(curr.text,this.labels.vars))
				this.diag.add(vsserv.Diagnostic.create(rng,'variable is undefined',vsserv.DiagnosticSeverity.Error));
			else if (is_var && !this.running.has(curr.text))
				this.diag.add(vsserv.Diagnostic.create(rng,'variable is forward referenced',vsserv.DiagnosticSeverity.Warning));
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
			else if (child.type=='var_label')
				this.running.add(curr.text);
		}
		else if (curr.type=='macro_ref')
		{
			if (!Defined(curr.text,this.labels.macros) && Defined(curr.text,this.labels.globals))
				this.diag.add(vsserv.Diagnostic.create(rng,'expected macro, this is a label',vsserv.DiagnosticSeverity.Error));
			else if (!Defined(curr.text,this.labels.macros))
				this.diag.add(vsserv.Diagnostic.create(rng,'macro is undefined',vsserv.DiagnosticSeverity.Error));
			else if (!this.running.has(curr.text))
				this.diag.add(vsserv.Diagnostic.create(rng,'macro is forward referenced',vsserv.DiagnosticSeverity.Error));
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
			this.inMacro = false;
		}
		else if (curr.type=='macro_def')
		{
			this.running.add(curr.text);
			this.inMacro = true;
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
		this.running = new Set<string>();
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		this.diag = new DiagnosticSet;
		this.context.analyze(document, this.running, this.visit_gather.bind(this));
	}
	/**
	 * verify the label set associated with a document, assumes label set has been built
	 * @param document this can be the document being displayed, if not a master, the master will be found
	 */
	verify_main(document: vsserv.TextDocumentItem,ctx: MerlinContext)
	{
		this.context = ctx;
		this.running = new Set<string>();
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		this.context.analyze(document, this.running, this.visit_verify.bind(this));
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
