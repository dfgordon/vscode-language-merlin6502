import * as vscode from 'vscode';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { LangExtBase, WalkerOptions, WalkerChoice, SourceOptions, SourceType } from './langExtBase';
import * as path from 'path';

function AddLabel(txt: string,lnode: LabelNode,lst: Map<string,Array<LabelNode>>)
{
    if (!lst.has(txt))
        lst.set(txt,new Array<LabelNode>());
    lst.get(txt)?.push(lnode);
}

export class LabelNode
{
	doc: vscode.TextDocument | null;
	rng: vscode.Range;
    isEntry: boolean;
    isExternal: boolean;
    isDef: boolean;
    isRef: boolean;
	constructor(doc: vscode.TextDocument | null,node: Parser.SyntaxNode,rng: vscode.Range)
	{
		const parent = node.parent;
		this.doc = doc;
		this.rng = rng;
		this.isEntry = false;
		this.isExternal = false;
		if (parent && parent.type=="pseudo_operation")
		{
			for (const child of parent.children)
			{
				if (child.type=="psop_ent")
					this.isEntry = true;
				if (child.type=="psop_ext" || child.type=="psop_exd")
					this.isExternal = true;
			}
		}
		this.isDef = node.type=="label_def",
		this.isRef = node.type=="label_ref";
	}
}

export class LabelSet
{
	globals : Map<string,Array<LabelNode>> = new Map<string,Array<LabelNode>>();
	locals : Map<string,Array<LabelNode>> = new Map<string,Array<LabelNode>>();
	vars : Map<string,Array<LabelNode>> = new Map<string,Array<LabelNode>>();
	macros : Map<string,Array<LabelNode>> = new Map<string,Array<LabelNode>>();
}

export class LabelSentry extends LangExtBase
{
	diag = new Array<vscode.Diagnostic>();
	labels = new LabelSet();
	running = new Set<string>();
	entries = new Map<string,Array<LabelNode>>();
	inMacro = false;
	currScope = '';
	docs = new Array<vscode.TextDocument>();
	enclosingRng = new vscode.Range(0,0,0,0);
	typ : SourceType = SourceOptions.master;
	currDoc : vscode.TextDocument | null = null;
	async prepare_externals(docs: vscode.Uri[])
	{
		this.docs = new Array<vscode.TextDocument>();
		for (let uri of docs)
			this.docs.push(await vscode.workspace.openTextDocument(uri));
	}
	/// Gather all labels while checking for redefinitions.
	visit_gather(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		if (child && curr.type=='label_def')
		{
            const lnode = new LabelNode(this.currDoc,curr,this.curs_to_range(curs,this.row,this.col)); // `rng` could be enclosing range, so recompute
			if (child.type=='global_label' && curs.currentFieldName()=='mac')
			{
				if (this.typ==SourceOptions.put)
					diag.push(new vscode.Diagnostic(rng,'macros are not allowed in PUT files'));
				if (child.text.match(this.opExactPattern) || child.text.match(this.psopExactPattern))
					diag.push(new vscode.Diagnostic(rng,'macro name matches a mnemonic',vscode.DiagnosticSeverity.Warning));
				if (this.labels.macros.has(child.text))
					diag.push(new vscode.Diagnostic(rng,'redefinition of a macro',vscode.DiagnosticSeverity.Error));
				if (this.labels.globals.has(child.text))
					diag.push(new vscode.Diagnostic(rng,'macro name is used previously as a label',vscode.DiagnosticSeverity.Error));
				AddLabel(child.text,lnode,this.labels.macros);
			}
			else if (child.type=='global_label')
			{
				if (this.labels.globals.has(child.text))
					diag.push(new vscode.Diagnostic(rng,'redefinition of a global label',vscode.DiagnosticSeverity.Error));
				if (this.labels.macros.has(child.text))
					diag.push(new vscode.Diagnostic(rng,'label name is used previously as a macro'))
				AddLabel(child.text,lnode,this.labels.globals);
				this.currScope = child.text;
			}
			else if (curs.currentFieldName()=='mac')
			{
				diag.push(new vscode.Diagnostic(rng,'macro label needs to be global',vscode.DiagnosticSeverity.Error));
			}
			else if (child.type=='local_label')
			{
				const xName = this.currScope + '\u0100' + child.text;
				if (this.labels.locals.has(xName))
					diag.push(new vscode.Diagnostic(rng,'redefinition of a local label',vscode.DiagnosticSeverity.Error));
				AddLabel(xName,lnode,this.labels.locals);
			}
			else if (child.type=='var_label')
			{
				AddLabel(child.text,lnode,this.labels.vars);
			}
		}
	}
	visit_verify(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const macroAverse = ['psop_ent','psop_ext','psop_exd','psop_put','psop_use','psop_sav'];
		const curr = curs.currentNode();
		const child = curr.firstChild;
		const is_var = (child && child.type=='var_label') && (![...'123456789'].includes(curr.text[1]) || curr.text.length>2);
		const localLabelExt = this.currScope + '\u0100' + curr.text;
		if (curr.type=="psop_use" && this.typ!=SourceOptions.master)
			this.diag.push(new vscode.Diagnostic(rng,'recursive USE found within this file',vscode.DiagnosticSeverity.Error));
		else if (curr.type=="psop_put" && this.typ!=SourceOptions.master)
			this.diag.push(new vscode.Diagnostic(rng,'recursive PUT found within this file',vscode.DiagnosticSeverity.Error));
		else if (this.inMacro && macroAverse.includes(curr.type))
			this.diag.push(new vscode.Diagnostic(rng,'pseudo operation cannot be used in a macro',vscode.DiagnosticSeverity.Error));
		else if (curr.type=='psop_eom')
		{
			if (this.inMacro==false)
				diag.push(new vscode.Diagnostic(rng,'unmatched end of macro (EOM terminates all preceding MAC pseudo-ops)',vscode.DiagnosticSeverity.Error));
			this.inMacro = false;
		}
		else if (curr.type=='label_def' && curs.currentFieldName()=='mac')
		{
			this.running.add(curr.text);
			this.inMacro = true;
		}
		else if (curr.type=='label_ref' && curs.currentFieldName()=='mac')
		{
			const count = diag.length;
			if (!this.labels.macros.has(curr.text) && this.labels.globals.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'expected macro, this is a label',vscode.DiagnosticSeverity.Error));
			else if (!this.labels.macros.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'macro is undefined',vscode.DiagnosticSeverity.Error));
			else if (!this.running.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'macro is forward referenced',vscode.DiagnosticSeverity.Error));
			if (count<diag.length)
				return;
		}
		else if (child && curr.type=='label_ref' && curs.currentFieldName()!='mac')
		{
			const count = diag.length;
			if (child.type=='global_label' && this.labels.macros.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'macro cannot be used here',vscode.DiagnosticSeverity.Error));
			else if (child.type=='global_label' && !this.labels.globals.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'global label is undefined',vscode.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && !this.labels.locals.has(localLabelExt))
				diag.push(new vscode.Diagnostic(rng,'local label is not defined in this scope',vscode.DiagnosticSeverity.Error));
			else if (child.type=='local_label' && this.inMacro)
				diag.push(new vscode.Diagnostic(rng,'cannot use local labels in a macro',vscode.DiagnosticSeverity.Error));
			else if (is_var && !this.labels.vars.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'variable is undefined',vscode.DiagnosticSeverity.Error));
			else if (is_var && !this.running.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'variable is forward referenced',vscode.DiagnosticSeverity.Warning));
			if (count<diag.length)
				return;
		}
		else if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
				this.currScope = curr.text;
			else if (child.type=='local_label')
			{
				if (this.currScope=='')
					diag.push(new vscode.Diagnostic(rng,'no global scope defined yet',vscode.DiagnosticSeverity.Error));
				const next = curr.nextNamedSibling;
				if (next && (next.type=='psop_mac' || next.type=='psop_ent' || next.type=='psop_ext' || next.type=='psop_equ'))
					diag.push(new vscode.Diagnostic(rng,'cannot use local label for ' + next.text,vscode.DiagnosticSeverity.Error));
				if (this.inMacro)
					diag.push(new vscode.Diagnostic(rng,'cannot use local labels in a macro',vscode.DiagnosticSeverity.Error));
			}
			else if (child.type=='var_label')
				this.running.add(curr.text);
		}
	}
	dispatch_gather(curs: Parser.TreeCursor) : WalkerChoice
	{
		this.visit_gather(this.diag,curs,this.curs_to_range(curs,this.row,this.col));
		if (curs.nodeType=="psop_use")
			this.process_include(curs.currentNode().nextNamedSibling,SourceOptions.use,this.dispatch_gather_include);
		if (curs.nodeType=="psop_put")
			this.process_include(curs.currentNode().nextNamedSibling,SourceOptions.put,this.dispatch_gather_include);
		return WalkerOptions.gotoChild;
	}
	dispatch_gather_include(curs: Parser.TreeCursor) : WalkerChoice
	{
		this.visit_gather(this.diag,curs,this.enclosingRng);
		return WalkerOptions.gotoChild;
	}
	dispatch_verify(curs: Parser.TreeCursor) : WalkerChoice
	{
		this.visit_verify(this.diag,curs,this.curs_to_range(curs,this.row,this.col));
		if (curs.nodeType=="psop_use")
			this.process_include(curs.currentNode().nextNamedSibling,SourceOptions.use,this.dispatch_verify_include);
		if (curs.nodeType=="psop_put")
			this.process_include(curs.currentNode().nextNamedSibling,SourceOptions.put,this.dispatch_verify_include);
		return WalkerOptions.gotoChild;
	}
	dispatch_verify_include(curs: Parser.TreeCursor) : WalkerChoice
	{
		this.visit_verify(this.diag,curs,this.enclosingRng);
		return WalkerOptions.gotoChild;
	}
	build_main(document: vscode.TextDocument)
	{
		this.GetProperties(document);
        this.labels = new LabelSet();
		this.running = new Set<string>();
		this.currDoc = null;
		this.currScope = '';
		this.inMacro = false;
		this.diag.length = 0;
		for (this.row=0;this.row<document.lineCount;this.row++)
		{
			const tree = this.parse(this.AdjustLine(document,this.labels.macros),"\n");
			this.walk(tree,this.dispatch_gather.bind(this));
		}
	}
	verify_main(document: vscode.TextDocument)
	{
		this.running = new Set<string>();
		this.currDoc = null;
		this.currScope = '';
		this.inMacro = false;
		for (this.row=0;this.row<document.lineCount;this.row++)
		{
			const tree = this.parse(this.AdjustLine(document,this.labels.macros),"\n");
			this.walk(tree,this.dispatch_verify.bind(this));
		}
		// correlate EXT and ENT
		for (const [lbl,lst] of this.labels.globals)
			for (const lnode of lst)
				if (lnode.isExternal && !this.entries.has(lbl))
					this.diag.push(new vscode.Diagnostic(lnode.rng,'no corresponding entry was found in the workspace',vscode.DiagnosticSeverity.Warning));
	}
	process_include(fileNode: Parser.SyntaxNode | null, newType: SourceType, dispatch: (curs: Parser.TreeCursor) => WalkerChoice)
	{
		if (!fileNode)
			return;
		let matches = 0;
		this.enclosingRng = this.node_to_range(fileNode,this.row,this.col);
		const fileName = path.posix.basename(fileNode.text);
		for (const doc of this.docs)
		{
			const docName = path.basename(doc.uri.path,'.S')
			if (docName==fileName)
			{
				matches++;
				if (matches==1)
				{
					this.typ = newType;
					this.currDoc = doc;
					const oldRow = this.row;
					const oldCol = this.col;
					for (this.row=0;this.row<doc.lineCount;this.row++)
					{
						const tree = this.parse(this.AdjustLine(doc,this.labels.macros),"\n");
						this.walk(tree,dispatch.bind(this));
					}
					this.row = oldRow;
					this.col = oldCol;
					this.typ = SourceOptions.master;
					this.currDoc = null;
				}
			}
		}
		if (matches==0 && dispatch==this.dispatch_gather_include)
			this.diag.push(new vscode.Diagnostic(this.enclosingRng,'file not found in workspace',vscode.DiagnosticSeverity.Error));
		if (matches>1 && dispatch==this.dispatch_gather_include)
			this.diag.push(new vscode.Diagnostic(this.enclosingRng,'multiple matches ('+matches+') exist in the workspace',vscode.DiagnosticSeverity.Error));
	}
	visit_entries(curs: Parser.TreeCursor) : WalkerChoice
	{
		if (curs.nodeType=='source_file')
			return WalkerOptions.gotoChild;
		if (curs.nodeType=='pseudo_operation')
		{
			const child1 = curs.currentNode().firstNamedChild;
			if (child1 && child1.type=='label_def' && child1.nextNamedSibling && child1.nextNamedSibling.type=='psop_ent')
				AddLabel(child1.text,new LabelNode(this.currDoc,child1,this.node_to_range(child1,this.row,this.col)),this.entries);
			if (child1 && child1.type=='psop_ent')
			{
				let sib = child1.nextNamedSibling;
				while (sib && sib.type=='label_ref')
				{
					AddLabel(sib.text,new LabelNode(this.currDoc,sib,this.node_to_range(sib,this.row,this.col)),this.entries);
					sib = sib.nextNamedSibling;
				}
			}
		}
		return WalkerOptions.exit;
	}
	scan_entries()
	{
		this.entries = new Map<string,Array<LabelNode>>();
		for (const document of this.docs)
		{
			this.currDoc = document;
			for (this.row=0;this.row<document.lineCount;this.row++)
			{
				const tree = this.parse(this.AdjustLine(document,this.labels.macros),"\n");
				this.walk(tree,this.visit_entries.bind(this));
			}
		}
	}
}