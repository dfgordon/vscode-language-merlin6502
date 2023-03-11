import * as vsserv from 'vscode-languageserver';
import * as vsdoc from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as path from 'path';

function Defined(name: string, map: Map<string, LabelNode[]>): boolean
{
	const lnodes = map.get(name);
	if (!lnodes)
		return false;
	return lnodes[0].definedAnywhere;
}

function AddLabel(txt: string,lnode: LabelNode,map: Map<string,Array<LabelNode>>)
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
	definedAnywhere: boolean;
	children: ChildLabel[];
	constructor(doc: vsserv.TextDocumentItem, node: Parser.SyntaxNode, rng: vsserv.Range)
	{
		const next = node.nextNamedSibling;
		const parent = node.parent;
		this.doc = doc;
		this.rng = rng;
		this.isEntry = false;
		this.isExternal = false;
		this.isSub = false;
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

export class LabelSet
{
	includedDocs = new Set<string>();
	globals = new Map<string,Array<LabelNode>>();
	locals = new Map<string,Array<LabelNode>>();
	vars = new Map<string,Array<LabelNode>>();
	macros = new Map<string,Array<LabelNode>>();
}

export class LabelSentry extends lxbase.LangExtBase
{
	diag = new Array<vsserv.Diagnostic>();
	workspaceFolders = new Array<vsserv.WorkspaceFolder>();
	entries = new Map<string, Array<LabelNode>>();
	private labels = new LabelSet(); // temporary while building labels for a document
	shared = new Map<string,LabelSet>(); // mapping document uri to label set
	running = new Set<string>();
	inMacro = false;
	currScopeName = '';
	currScopeNode : LabelNode | undefined;
	workspaceDocs = new Array<vsserv.TextDocumentItem>();
	rescan_entries = true;
	enclosingRng = vsserv.Range.create(0,0,0,0);
	typ: lxbase.SourceType = lxbase.SourceOptions.master;
	currMain: vsserv.TextDocumentItem | null = null;
	currInclude: vsserv.TextDocumentItem | null = null;
	currModule: vsserv.TextDocumentItem | null = null;
	currDoc : vsserv.TextDocumentItem | null = null;
	currNode : Parser.SyntaxNode | null = null;
	refResult: vsserv.Location[] = [];
	renResult: vsserv.TextEdit[] = [];
	replacementText = '';
	/// Gather all labels while checking for redefinitions.
	visit_gather(diag: Array<vsserv.Diagnostic>,curs: Parser.TreeCursor,rng: vsserv.Range)
	{
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		if (!this.currDoc)
			return;
		if (child && curr.type == 'macro_def')
		{
			if (this.typ != lxbase.SourceOptions.master)
				this.labels.includedDocs.add(this.currDoc.uri);
			const lnode = new LabelNode(this.currDoc, curr, lxbase.curs_to_range(curs, this.row, this.col)); // `rng` could be enclosing range, so recompute
			if (child.type=='global_label')
			{
				if (this.typ==lxbase.SourceOptions.put)
					diag.push(vsserv.Diagnostic.create(rng,'macros are not allowed in PUT files'));
				if (child.text.match(this.opExactPattern) || child.text.match(this.psopExactPattern))
					diag.push(vsserv.Diagnostic.create(rng,'macro name matches a mnemonic',vsserv.DiagnosticSeverity.Warning));
				if (Defined(child.text,this.labels.macros))
					diag.push(vsserv.Diagnostic.create(rng,'redefinition of a macro',vsserv.DiagnosticSeverity.Error));
				if (Defined(child.text,this.labels.globals))
					diag.push(vsserv.Diagnostic.create(rng,'macro name is used previously as a label',vsserv.DiagnosticSeverity.Error));
				AddLabel(child.text, lnode, this.labels.macros);
			}			
			else
			{
				diag.push(vsserv.Diagnostic.create(rng,'macro label needs to be global',vsserv.DiagnosticSeverity.Error));
			}
		}
		if (child && curr.type=='label_def')
		{
			if (this.typ != lxbase.SourceOptions.master)
				this.labels.includedDocs.add(this.currDoc.uri);
			const lnode = new LabelNode(this.currDoc, curr, lxbase.curs_to_range(curs, this.row, this.col)); // `rng` could be enclosing range, so recompute
			if (child.type=='global_label')
			{
				if (Defined(child.text,this.labels.globals))
					diag.push(vsserv.Diagnostic.create(rng,'redefinition of a global label',vsserv.DiagnosticSeverity.Error));
				if (Defined(child.text,this.labels.macros))
					diag.push(vsserv.Diagnostic.create(rng,'label name is used previously as a macro'))
				AddLabel(child.text, lnode, this.labels.globals);
				this.currScopeName = child.text;
				this.currScopeNode = lnode;
			}
			else if (child.type=='local_label')
			{
				const xName = this.currScopeName + '\u0100' + child.text;
				if (Defined(xName,this.labels.locals))
					diag.push(vsserv.Diagnostic.create(rng,'redefinition of a local label',vsserv.DiagnosticSeverity.Error));
				AddLabel(xName, lnode, this.labels.locals);
				if (this.currScopeNode && this.currScopeNode.doc.uri==this.currDoc.uri)
					this.currScopeNode.children.push(new ChildLabel(this.currDoc.uri,lnode.rng,child.text));
			}
			else if (child.type=='var_label')
			{
				AddLabel(child.text,lnode,this.labels.vars);
			}
		}
		if (child && curr.type == 'macro_ref')
		{
            const lnode = new LabelNode(this.currDoc,curr,lxbase.curs_to_range(curs,this.row,this.col)); // `rng` could be enclosing range, so recompute
			if (child.type=='global_label')
				AddLabel(child.text,lnode,this.labels.macros);
		}
		if (child && curr.type == 'label_ref')
		{
            const lnode = new LabelNode(this.currDoc,curr,lxbase.curs_to_range(curs,this.row,this.col)); // `rng` could be enclosing range, so recompute
			if (child.type=='global_label')
				AddLabel(child.text,lnode,this.labels.globals);
			else if (child.type=='local_label') {
				const xName = this.currScopeName + '\u0100' + child.text;
				AddLabel(xName,lnode,this.labels.locals);
			}
			else if (child.type=='var_label')
				AddLabel(child.text,lnode,this.labels.vars);
		}
	}
	visit_verify(diag: Array<vsserv.Diagnostic>,curs: Parser.TreeCursor,rng: vsserv.Range)
	{
		const macroAverse = ['psop_ent','psop_ext','psop_exd','psop_put','psop_use','psop_sav'];
		const curr = curs.currentNode();
		const child = curr.firstChild;
		const is_var = (child && child.type=='var_label') && (![...'123456789'].includes(curr.text[1]) || curr.text.length>2);
		const localLabelExt = this.currScopeName + '\u0100' + curr.text;
		if (curr.type=="psop_use" && this.typ!=lxbase.SourceOptions.master)
			this.diag.push(vsserv.Diagnostic.create(rng,'recursive USE found within this file',vsserv.DiagnosticSeverity.Error));
		else if (curr.type=="psop_put" && this.typ!=lxbase.SourceOptions.master)
			this.diag.push(vsserv.Diagnostic.create(rng,'recursive PUT found within this file',vsserv.DiagnosticSeverity.Error));
		else if (this.inMacro && macroAverse.includes(curr.type))
			this.diag.push(vsserv.Diagnostic.create(rng,'pseudo operation cannot be used in a macro',vsserv.DiagnosticSeverity.Error));
		else if (curr.type=='psop_eom')
		{
			if (this.inMacro==false)
				diag.push(vsserv.Diagnostic.create(rng,'unmatched end of macro (EOM terminates all preceding MAC pseudo-ops)',vsserv.DiagnosticSeverity.Error));
			this.inMacro = false;
		}
		else if (curr.type=='macro_def')
		{
			this.running.add(curr.text);
			this.inMacro = true;
		}
		else if (curr.type=='macro_ref')
		{
			const count = diag.length;
			if (!Defined(curr.text,this.labels.macros) && Defined(curr.text,this.labels.globals))
				diag.push(vsserv.Diagnostic.create(rng,'expected macro, this is a label',vsserv.DiagnosticSeverity.Error));
			else if (!Defined(curr.text,this.labels.macros))
				diag.push(vsserv.Diagnostic.create(rng,'macro is undefined',vsserv.DiagnosticSeverity.Error));
			else if (!this.running.has(curr.text))
				diag.push(vsserv.Diagnostic.create(rng,'macro is forward referenced',vsserv.DiagnosticSeverity.Error));
			if (count<diag.length)
				return;
		}
		else if (child && curr.type=='label_ref')
		{
			const count = diag.length;
			if (child.type=='global_label' && Defined(curr.text,this.labels.macros))
				diag.push(vsserv.Diagnostic.create(rng,'macro cannot be used here',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='global_label' && !Defined(curr.text,this.labels.globals))
				diag.push(vsserv.Diagnostic.create(rng,'global label is undefined',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && !Defined(localLabelExt,this.labels.locals))
				diag.push(vsserv.Diagnostic.create(rng,'local label is not defined in this scope',vsserv.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && this.inMacro)
				diag.push(vsserv.Diagnostic.create(rng,'cannot use local labels in a macro',vsserv.DiagnosticSeverity.Error));
			else if (is_var && !Defined(curr.text,this.labels.vars))
				diag.push(vsserv.Diagnostic.create(rng,'variable is undefined',vsserv.DiagnosticSeverity.Error));
			else if (is_var && !this.running.has(curr.text))
				diag.push(vsserv.Diagnostic.create(rng,'variable is forward referenced',vsserv.DiagnosticSeverity.Warning));
			if (count<diag.length)
				return;
		}
		else if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
				this.currScopeName = curr.text;
			else if (child.type=='local_label')
			{
				if (this.currScopeName=='')
					diag.push(vsserv.Diagnostic.create(rng,'no global scope defined yet',vsserv.DiagnosticSeverity.Error));
				const next = curr.nextNamedSibling;
				if (next && (next.type=='psop_mac' || next.type=='psop_ent' || next.type=='psop_ext' || next.type=='psop_equ'))
					diag.push(vsserv.Diagnostic.create(rng,'cannot use local label for ' + next.text,vsserv.DiagnosticSeverity.Error));
				if (this.inMacro)
					diag.push(vsserv.Diagnostic.create(rng,'cannot use local labels in a macro',vsserv.DiagnosticSeverity.Error));
			}
			else if (child.type=='var_label')
				this.running.add(curr.text);
		}
	}
	dispatch_gather(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.visit_gather(this.diag,curs,lxbase.curs_to_range(curs,this.row,this.col));
		if (curs.nodeType=="psop_use")
			this.process_include(curs.currentNode().nextNamedSibling,lxbase.SourceOptions.use,this.dispatch_gather_include);
		if (curs.nodeType=="psop_put")
			this.process_include(curs.currentNode().nextNamedSibling,lxbase.SourceOptions.put,this.dispatch_gather_include);
		return lxbase.WalkerOptions.gotoChild;
	}
	dispatch_gather_include(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.visit_gather(this.diag,curs,this.enclosingRng);
		return lxbase.WalkerOptions.gotoChild;
	}
	dispatch_verify(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.visit_verify(this.diag,curs,lxbase.curs_to_range(curs,this.row,this.col));
		if (curs.nodeType=="psop_use")
			this.process_include(curs.currentNode().nextNamedSibling,lxbase.SourceOptions.use,this.dispatch_verify_include);
		if (curs.nodeType=="psop_put")
			this.process_include(curs.currentNode().nextNamedSibling,lxbase.SourceOptions.put,this.dispatch_verify_include);
		return lxbase.WalkerOptions.gotoChild;
	}
	dispatch_verify_include(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		this.visit_verify(this.diag,curs,this.enclosingRng);
		return lxbase.WalkerOptions.gotoChild;
	}
	build_main(document: vsdoc.TextDocument)
	{
		const lines = document.getText().split('\n');
		this.GetProperties(lines);
		this.labels = new LabelSet();
		this.running = new Set<string>();
		this.currMain = vsserv.TextDocumentItem.create(document.uri,document.languageId,document.version,document.getText());
		this.currDoc = this.currMain;
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		this.diag.length = 0;
		for (this.row=0;this.row<document.lineCount;this.row++)
		{
			const tree = this.parse(this.AdjustLine(lines,this.labels.macros),"\n");
			this.walk(tree,this.dispatch_gather.bind(this));
		}
		this.shared.set(document.uri, this.labels);
	}
	verify_main(document: vsdoc.TextDocument)
	{
		const lines = document.getText().split('\n');
		this.running = new Set<string>();
		this.currDoc = this.currMain;
		this.currScopeName = '';
		this.currScopeNode = undefined;
		this.inMacro = false;
		for (this.row=0;this.row<document.lineCount;this.row++)
		{
			const tree = this.parse(this.AdjustLine(lines,this.labels.macros),"\n");
			this.walk(tree,this.dispatch_verify.bind(this));
		}
		// correlate EXT and ENT
		for (const [lbl,lst] of this.labels.globals)
			for (const lnode of lst)
				if (lnode.isExternal && !this.entries.has(lbl))
					this.diag.push(vsserv.Diagnostic.create(lnode.rng,'no corresponding entry was found in the workspace',vsserv.DiagnosticSeverity.Warning));
	}
	process_include(fileNode: Parser.SyntaxNode | null, newType: lxbase.SourceType, dispatch: (curs: Parser.TreeCursor) => lxbase.WalkerChoice)
	{
		if (!fileNode)
			return;
		let matches = 0;
		this.enclosingRng = lxbase.node_to_range(fileNode,this.row,this.col);
		const fileName = path.posix.basename(fileNode.text);
		for (const doc of this.workspaceDocs)
		{
			const docName = path.basename(doc.uri, '.S');
			if (docName==fileName)
			{
				const lines = doc.text.split('\n');
				matches++;
				if (matches==1)
				{
					const oldRow = this.row;
					const oldCol = this.col;
					this.typ = newType;
					this.currInclude = doc;
					this.currDoc = doc;
					for (this.row=0;this.row<lines.length;this.row++)
					{
						const tree = this.parse(this.AdjustLine(lines,this.labels.macros),"\n");
						this.walk(tree,dispatch.bind(this));
					}
					this.row = oldRow;
					this.col = oldCol;
					this.currInclude = null;
					this.currDoc = this.currMain;
					this.typ = lxbase.SourceOptions.master;
				}
			}
		}
		if (matches==0 && dispatch==this.dispatch_gather_include)
			this.diag.push(vsserv.Diagnostic.create(this.enclosingRng,'file not found in workspace',vsserv.DiagnosticSeverity.Error));
		if (matches>1 && dispatch==this.dispatch_gather_include)
			this.diag.push(vsserv.Diagnostic.create(this.enclosingRng,'multiple matches ('+matches+') exist in the workspace',vsserv.DiagnosticSeverity.Error));
	}
	visit_entries(curs: Parser.TreeCursor) : lxbase.WalkerChoice
	{
		if (!this.currModule)
			return lxbase.WalkerOptions.exit;
		if (curs.nodeType=='source_file')
			return lxbase.WalkerOptions.gotoChild;
		if (curs.nodeType=='pseudo_operation')
		{
			const child1 = curs.currentNode().firstNamedChild;
			if (child1 && child1.type=='label_def' && child1.nextNamedSibling && child1.nextNamedSibling.type=='psop_ent')
				AddLabel(child1.text,new LabelNode(this.currModule,child1,lxbase.node_to_range(child1,this.row,this.col)),this.entries);
			if (child1 && child1.type=='psop_ent')
			{
				let sib = child1.nextNamedSibling?.firstNamedChild;
				while (sib && sib.type=='label_ref')
				{
					AddLabel(sib.text,new LabelNode(this.currModule,sib,lxbase.node_to_range(sib,this.row,this.col)),this.entries);
					sib = sib.nextNamedSibling;
				}
			}
		}
		return lxbase.WalkerOptions.exit;
	}
	scan_entries(docs: Array<vsserv.TextDocumentItem>)
	{
		this.workspaceDocs = docs;
		this.entries = new Map<string, Array<LabelNode>>();
		for (const doc of this.workspaceDocs)
		{
			this.currModule = doc;
			const lines = doc.text.split('\n');
			for (this.row=0;this.row<lines.length;this.row++)
			{
				if (lines[this.row].search(/^\S*\s+ENT/i)==-1)
					continue; // maybe save some time
				const tree = this.parse(this.AdjustLine(lines,this.labels.macros),"\n");
				this.walk(tree,this.visit_entries.bind(this));
			}
			this.currModule = null;
		}
		this.rescan_entries = false;
	}
}
