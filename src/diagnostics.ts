import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as opcodes from './opcodes.json';

class ProcessorModeSentry
{
	xcCount = 0;
	programLine = 0;
	ops = Object(opcodes);
	modeMap = Object({
		'imm': ['imm'],
		'addr': ['abs','zp','rel','rell','absl'],
		'iaddr_ix': ['(zp,x)','(abs,x)'],
		'iaddr_y': ['(zp),y'],
		'addr_x': ['zp,x','abs,x','absl,x'],
		'addr_y': ['zp,y','abs,y'],
		'iaddr': ['(abs)','(zp)'],
		'daddr': ['[d]'],
		'daddr_y': ['[d],y'],
		'addr_s': ['d,s'],
		'iaddr_is_y': ['(d,s),y'],
		'xyc': ['xyc']
	});
	reset()
	{
		this.xcCount = 0;
		this.programLine = 0;
	}
	visit(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const parent = curr.parent;
		const prev = curr.previousSibling;
		if (parent && parent.type=='source_file' && curr.type!="main_comment")
			this.programLine += 1;
		if (curr.type=='psop_xc')
		{
			if (this.xcCount==0 && this.programLine!=1)
			{
				diag.push(new vscode.Diagnostic(rng,'XC must appear first',vscode.DiagnosticSeverity.Error));
				return;
			}
			if (this.xcCount==1 && this.programLine!=2)
			{
				diag.push(new vscode.Diagnostic(rng,'XC sequence must be uninterrupted',vscode.DiagnosticSeverity.Error));
				return;
			}
			if (this.xcCount==2)
			{
				diag.push(new vscode.Diagnostic(rng,'XC should not appear more than twice',vscode.DiagnosticSeverity.Error));
				return;
			}
			this.xcCount += 1;
		}
		if (this.xcCount==2) // all modes are valid so exit now
			return;
		const req = this.xcCount==0 ? '6502' : '65c02';
		if (curr.type.substring(0,3)=='op_')
		{
			const availProcessors = this.ops[curr.text.substring(0,3).toLowerCase()].processors;
			if (!availProcessors.includes(req))
			{
				diag.push(new vscode.Diagnostic(rng,'operation disabled, use XC pseudo-op to enable',vscode.DiagnosticSeverity.Error));
				return;
			}
		}
		const availModes = this.modeMap[curr.type];
		if (availModes && prev && prev.type.substring(0,3)=='op_')
		{
			const modeList = this.ops[prev.text.substring(0,3).toLowerCase()].modes;
			for (const mode of modeList)
			{
				const procOK = mode.processors.includes(req);
				const availOK = availModes.includes(mode.addr_mnemonic);
				if (procOK && availOK)
					return;
			}
			if (parent && !parent.hasError())
				diag.push(new vscode.Diagnostic(rng,'addressing mode disabled, use XC pseudo-op to enable',vscode.DiagnosticSeverity.Error));
		}
	}
}

// Check for label errors:
// * local labels in macros, MAC, ENT, EXT, EQU, or first
// * illegal forward references
// * redefinition of global labels or local labels in the same scope
// * macro names are reserved, and cannot be forward referenced
// The sets `macros` and `globals` will overlap

class LabelSentry
{
	Globals : Set<string>;
	Locals : Set<string>;
	Vars : Set<string>;
	Macros : Set<string>;
	currScope = '';
	inMacro = false;
	useFiles = 0;

	constructor()
	{
		this.Globals = new Set<string>();
		this.Locals = new Set<string>();
		this.Vars = new Set<string>();
		this.Macros = new Set<string>();
	}
	reset()
	{
		this.currScope = '';
		this.inMacro = false;
		this.useFiles = 0;
	}
	/// Add all global and local labels while checking for redefinitions.
	/// Macros are added to the `Globals` set but to the `Macros` set.
	/// This allows us to check for forward referenced macros in the second pass.
	visit_gather(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		const next = curr.nextNamedSibling;
		if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
			{
				if (this.Globals.has(child.text))
				{
					diag.push(new vscode.Diagnostic(rng,'redefinition of a global label',vscode.DiagnosticSeverity.Error));
					return;
				}
				this.Globals.add(child.text);
				if (!(next && next.type=='psop_mac'))
					this.currScope = child.text;
			}
			if (child.type=='local_label')
			{
				if (this.Locals.has(this.currScope+child.text))
				{
					diag.push(new vscode.Diagnostic(rng,'redefinition of a local label',vscode.DiagnosticSeverity.Error));
					return;
				}
				this.Locals.add(this.currScope+child.text);
			}
		}
	}
	visit_verify(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const parent = curr.parent;
		const prev = curr.previousSibling;
		let localLabelExt = this.currScope + curr.text;
		if (curr.type=='psop_use')
		{
			this.useFiles += 1;
		}
		if (curr.type=='psop_mac')
		{
			if (prev)
				this.Macros.add(prev.text);
			this.inMacro = true;
		}
		if (curr.type=='psop_eom')
		{
			if (this.inMacro==false)
			{
				diag.push(new vscode.Diagnostic(rng,'unmatched end of macro (EOM terminates all preceding MAC pseudo-ops)',vscode.DiagnosticSeverity.Error));
				return;
			}
			this.inMacro = false;
		}
		if (curr.type=='global_label' && (parent && parent.type=='macro_call' || prev && prev.type=='psop_pmc' || parent && parent.type=='macro_call_forced'))
		{
			if (!this.Macros.has(curr.text) && this.Globals.has(curr.text))
			{
				if (this.useFiles>0)
					diag.push(new vscode.Diagnostic(rng,'macro might be forward referenced',vscode.DiagnosticSeverity.Warning));
				else
					diag.push(new vscode.Diagnostic(rng,'macro is forward referenced',vscode.DiagnosticSeverity.Error));
				return;
			}
			if (!this.Macros.has(curr.text) && !this.Globals.has(curr.text))
			{
				if (this.useFiles>0)
					diag.push(new vscode.Diagnostic(rng,'macro might be undefined',vscode.DiagnosticSeverity.Warning));
				else
					diag.push(new vscode.Diagnostic(rng,'macro is undefined',vscode.DiagnosticSeverity.Error));
				return;
			}
		}
		if (parent && parent.type!='label_def')
		{
			if (curr.type=='global_label' && !this.Globals.has(curr.text))
			{
				diag.push(new vscode.Diagnostic(rng,'global label is not defined in this file',vscode.DiagnosticSeverity.Warning));
				return;
			}
			if (curr.type=='local_label' && !this.Locals.has(localLabelExt))
			{
				diag.push(new vscode.Diagnostic(rng,'local label is not defined in this scope',vscode.DiagnosticSeverity.Error));
				return;
			}
			if (curr.type=='global_label' && !(parent.type=='macro_call_forced' || parent.type=='macro_call' || prev && prev.type=='psop_pmc') && this.Macros.has(curr.text))
			{
				diag.push(new vscode.Diagnostic(rng,'macro cannot be used here',vscode.DiagnosticSeverity.Error));
				return;
			}
			if (curr.type=='var_label' && ([...'123456789'].indexOf(curr.text[1])==-1 || curr.text.length>2) && !this.Vars.has(curr.text))
			{
				diag.push(new vscode.Diagnostic(rng,'forward referenced variable',vscode.DiagnosticSeverity.Warning));
				return;
			}
		}
		if (parent && parent.type=='label_def')
		{
			if (curr.type=='global_label')
			{
				this.currScope = curr.text;
			}
			if (curr.type=='local_label')
			{
				if (this.currScope=='')
				{
					diag.push(new vscode.Diagnostic(rng,'no global scope defined yet',vscode.DiagnosticSeverity.Error));
					return;
				}
				const next = parent.nextNamedSibling;
				if (next && (next.type=='psop_mac' || next.type=='psop_ent' || next.type=='psop_ext' || next.type=='psop_equ'))
				{
					diag.push(new vscode.Diagnostic(rng,'cannot use local label for ' + next.text,vscode.DiagnosticSeverity.Error));
					return;
				}
				if (this.inMacro)
				{
					diag.push(new vscode.Diagnostic(rng,'cannot use local labels in a macro',vscode.DiagnosticSeverity.Error));
					return;
				}
			}
			if (curr.type=='var_label')
			{
				this.Vars.add(curr.text);
			}
		}
	}
}

// Apparently no standard provider, so make one up
export class TSDiagnosticProvider extends lxbase.LangExtBase
{
	procSentry : ProcessorModeSentry;
	labelSentry : LabelSentry;
	diag : Array<vscode.Diagnostic>;
	constructor(TSInitResult : [Parser,Parser.Language,Parser.Language,boolean])
	{
		super(TSInitResult);
		this.procSentry = new ProcessorModeSentry();
		this.labelSentry = new LabelSentry();
		this.diag = new Array<vscode.Diagnostic>();
	}
	value_range(diag: Array<vscode.Diagnostic>,node: Parser.SyntaxNode,low:number,high:number)
	{
		if (node.type!="integer")
			return;
		const rng = this.node_to_range(node,this.row,this.col);
		const parsed = parseInt(node.text);
		if (!isNaN(parsed))
			if (parsed<low || parsed>high)
				diag.push(new vscode.Diagnostic(rng,'Out of range ('+low+','+high+')'));
	}
	is_error_inside(node: Parser.SyntaxNode): boolean
	{
		let child = node.firstChild;
		if (child)
		{
			do
			{
				if (child.hasError())
					return true;
				child = child.nextNamedSibling;
			} while (child);
		}
		return false;
	}
	visit_gather(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const rng = this.curs_to_range(curs,this.row,this.col);
		this.labelSentry.visit_gather(this.diag,curs,rng);
		return lxbase.WalkerOptions.gotoChild;
	}
	visit_verify(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const rng = this.curs_to_range(curs,this.row,this.col);
		this.labelSentry.visit_verify(this.diag,curs,rng);
		this.procSentry.visit(this.diag,curs,rng);
		if (curs.currentNode().hasError())
		{
			if (!this.is_error_inside(curs.currentNode()))
				this.diag.push(new vscode.Diagnostic(rng,curs.currentNode().toString(),vscode.DiagnosticSeverity.Error));
		}
		if (curs.currentNode().type=="filename")
		{
			const child = curs.currentNode().firstChild;
			if (child && child.type=="dos33")
				this.diag.push(new vscode.Diagnostic(rng,'name is valid for DOS 3.3, but not ProDOS',vscode.DiagnosticSeverity.Warning));
			if (child && child.type=="anyfs")
				this.diag.push(new vscode.Diagnostic(rng,'incorrect syntax',vscode.DiagnosticSeverity.Error));
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	update(document : vscode.TextDocument, collection: vscode.DiagnosticCollection): void
	{
		if (document && document.languageId=='merlin6502')
		{
			this.diag.length = 0;
			this.labelSentry = new LabelSentry();
			this.procSentry = new ProcessorModeSentry();
			this.GetLabels(document);
			// first pass gathers labels again, redundancy could perhaps be eliminated
			for (this.row=0;this.row<document.lineCount;this.row++)
			{
				const tree = this.parse(this.AdjustLine(document),"\n");
				this.walk(tree,this.visit_gather.bind(this));
			}
			this.labelSentry.reset();
			// second pass builds diagnostics
			for (this.row=0;this.row<document.lineCount;this.row++)
			{
				const tree = this.parse(this.AdjustLine(document),"\n");
				this.walk(tree,this.visit_verify.bind(this));
			}
			collection.set(document.uri, this.diag);
		}
		else
		{
			collection.clear();
		}
	}
}