import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';

class ProcessorModeSentry
{
	merlinVersion = 'v8';
	xcCount = 0;
	xcAppearances = 0;
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
	constructor(merlinVersion: string)
	{
		this.reset(merlinVersion);
	}
	reset(merlinVersion: string)
	{
		this.merlinVersion = merlinVersion;
		this.xcAppearances = 0;
		if (this.merlinVersion=='v8')
			this.xcCount = 0;
		else
			this.xcCount = 2;
	}
	visit(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const parent = curr.parent;
		const prev = curr.previousSibling;
		const next = curr.nextSibling;
		if (parent && parent.type=='source_file' && curr.type!="main_comment")
			this.programLine += 1;
		if (curr.type=='psop_xc')
		{
			this.xcAppearances += 1;
			if (this.xcAppearances!=this.programLine)
				diag.push(new vscode.Diagnostic(rng,'XC pseudo-ops must appear first and be uninterrupted',vscode.DiagnosticSeverity.Error));
			if (next && next.text.toUpperCase()=='OFF')
				this.xcCount = 0;
			else
				this.xcCount += 1;
			if (this.xcCount>2)
			{
				this.xcCount = 2;
				diag.push(new vscode.Diagnostic(rng,'this would cause the XC count to exceed 2',vscode.DiagnosticSeverity.Error));
			}
			return;
		}
		if (this.xcCount==2) // all modes are valid so exit now
			return;
		const req = this.xcCount==0 ? '6502' : '65c02';
		if (curr.type=='global_label' && curs.currentFieldName()=='mac')
		{
			const opInfo= this.ops[curr.text.toLowerCase()]?.processors;
			if (opInfo && !opInfo.includes(req))
			{
				diag.push(new vscode.Diagnostic(rng,'macro name matches a disabled instruction',vscode.DiagnosticSeverity.Information));
				return;
			}
		}
		if (curr.type.substring(0,3)=='op_')
		{
			const opInfo = this.ops[curr.text.substring(0,3).toLowerCase()]?.processors;
			if (opInfo && !opInfo.includes(req))
			{
				// should never get here
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

class PseudoOpSentry
{
	psops = Object(pseudo);
	merlinVersion = 'v8';
	constructor(merlinVersion: string)
	{
		this.merlinVersion = merlinVersion;
	}
	visit(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const prev = curr.previousSibling;

		if (curr.type=='global_label' && curs.currentFieldName()=='mac')
		{
			const psopInfo = this.psops[curr.text.toLowerCase()]?.version;
			if (psopInfo && !psopInfo.includes(this.merlinVersion))
			{
				diag.push(new vscode.Diagnostic(rng,'macro name matches a disabled pseudo-op',vscode.DiagnosticSeverity.Information));
				return;
			}
		}
		if (curr.type.substring(0,5)=='psop_')
		{
			const psopInfo = this.psops[curr.text.toLowerCase()]?.version;
			if (psopInfo && !psopInfo.includes(this.merlinVersion))
			{
				// should never get here
				diag.push(new vscode.Diagnostic(rng,'pseudo-op is disabled for the selected Merlin version',vscode.DiagnosticSeverity.Error));
				return;
			}
		}
		if (prev && prev.type.substring(0,5)=='psop_')
		{
			const psopInfo = this.psops[prev.text.toLowerCase()];
			if (this.merlinVersion=='v8' && psopInfo?.v8x)
			{
				const s = psopInfo.v8x
				const patt = RegExp(s.substring(1,s.length-1),'i');
				if (curr.text.match(patt))
					diag.push(new vscode.Diagnostic(rng,'pseudo-op argument is disabled for the selected Merlin version',vscode.DiagnosticSeverity.Error));
			}
			if (this.merlinVersion=='v16' && psopInfo?.v16x)
			{
				const s = psopInfo.v16x
				const patt = RegExp(s.substring(1,s.length-1),'i');
				if (curr.text.match(patt))
					diag.push(new vscode.Diagnostic(rng,'pseudo-op argument is disabled for the selected Merlin version',vscode.DiagnosticSeverity.Error));
			}
		}
	}
}

// Check for label errors:
// * local labels in macros, MAC, ENT, EXT, EQU, or first
// * illegal forward references
// * redefinition of global labels or local labels in the same scope
// * macro names are reserved, and cannot be forward referenced

class LabelSentry
{
	labels : lxbase.LabelSet;
	currScope = '';
	inMacro = false;
	useFiles = 0;
	putFiles = 0;
	opExactPattern : RegExp;
	psopExactPattern : RegExp;

	constructor(opPat: RegExp,psopPat: RegExp)
	{
		this.labels = new lxbase.LabelSet();
		this.opExactPattern = opPat;
		this.psopExactPattern = psopPat;
	}
	/// Reset is to be called between first (gather) and second (verify) passes
	reset()
	{
		this.currScope = '';
		this.inMacro = false;
		this.useFiles = 0;
		this.putFiles = 0;
	}
	/// Gather all labels while checking for redefinitions.
	visit_gather(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const child = curr.firstNamedChild;
		if (child && curr.type=='label_def')
		{
			if (child.type=='global_label')
			{
				if (curs.currentFieldName()=='mac')
				{
					if (child.text.match(this.opExactPattern) || child.text.match(this.psopExactPattern))
						diag.push(new vscode.Diagnostic(rng,'macro name matches a mnemonic',vscode.DiagnosticSeverity.Warning));
					if (this.labels.macros.has(child.text))
						diag.push(new vscode.Diagnostic(rng,'redefinition of a macro',vscode.DiagnosticSeverity.Error));
					if (this.labels.globals.has(child.text))
						diag.push(new vscode.Diagnostic(rng,'macro name is used previously as a label',vscode.DiagnosticSeverity.Error));
					this.labels.macros.add(child.text);
				}
				else
				{
					if (this.labels.globals.has(child.text))
						diag.push(new vscode.Diagnostic(rng,'redefinition of a global label',vscode.DiagnosticSeverity.Error));
					if (this.labels.macros.has(child.text))
						diag.push(new vscode.Diagnostic(rng,'label name is used previously as a macro'))
					this.labels.globals.add(child.text);
					this.currScope = child.text;
				}
			}
			else if (child.type=='local_label')
			{
				if (this.labels.locals.has(this.currScope+'\u0100'+child.text))
					diag.push(new vscode.Diagnostic(rng,'redefinition of a local label',vscode.DiagnosticSeverity.Error));
				this.labels.locals.add(this.currScope+'\u0100'+child.text);
			}
			else if (child.type=='var_label')
			{
				this.labels.vars.add(child.text);
			}
		}
	}
	visit_verify(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const parent = curr.parent;
		const is_var = (curr.type=='var_label') && (![...'123456789'].includes(curr.text[1]) || curr.text.length>2);
		const localLabelExt = this.currScope + '\u0100' + curr.text;
		if (curr.type=='psop_use')
			this.useFiles += 1;
		else if (curr.type=='psop_put')
			this.putFiles += 1;
		else if (curr.type=='label_def' && curs.currentFieldName()=='mac')
		{
			this.labels.runningMacros.add(curr.text);
			this.inMacro = true;
		}
		else if (curr.type=='psop_eom')
		{
			if (this.inMacro==false)
			{
				diag.push(new vscode.Diagnostic(rng,'unmatched end of macro (EOM terminates all preceding MAC pseudo-ops)',vscode.DiagnosticSeverity.Error));
				return;
			}
			this.inMacro = false;
		}
		else if (curr.type=='global_label' && curs.currentFieldName()=='mac')
		{
			const count = diag.length;
			if (parent && parent.type.substring(0,10)=='macro_call' && curr.text.match(this.opExactPattern) || curr.text.match(this.psopExactPattern))
				diag.push(new vscode.Diagnostic(rng,'settings require mnemonic to be upper case',vscode.DiagnosticSeverity.Error)); // in case parser is case sensitive
			else if (!this.labels.macros.has(curr.text) && this.labels.globals.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'expected macro, this is a label',vscode.DiagnosticSeverity.Error));
			else if (!this.labels.macros.has(curr.text) && this.useFiles>0)
				diag.push(new vscode.Diagnostic(rng,'macro might be undefined',vscode.DiagnosticSeverity.Warning));
			else if (!this.labels.macros.has(curr.text) && this.useFiles==0)
				diag.push(new vscode.Diagnostic(rng,'macro is undefined',vscode.DiagnosticSeverity.Error));
			else if (!this.labels.runningMacros.has(curr.text) && this.useFiles>0)
				diag.push(new vscode.Diagnostic(rng,'macro might be forward referenced',vscode.DiagnosticSeverity.Warning));
			else if (!this.labels.runningMacros.has(curr.text) && this.useFiles==0)
				diag.push(new vscode.Diagnostic(rng,'macro is forward referenced',vscode.DiagnosticSeverity.Error));
			if (count<diag.length)
				return;
		}
		else if (parent && parent.type!='label_def' && curs.currentFieldName()!='mac')
		{
			const count = diag.length;
			if (curr.type=='global_label' && this.labels.macros.has(curr.text))
				diag.push(new vscode.Diagnostic(rng,'macro cannot be used here',vscode.DiagnosticSeverity.Error));
			else if (curr.type=='global_label' && !this.labels.globals.has(curr.text) && this.useFiles+this.putFiles>0)
				diag.push(new vscode.Diagnostic(rng,'global label might be undefined',vscode.DiagnosticSeverity.Warning));
			else if (curr.type=='global_label' && !this.labels.globals.has(curr.text) && this.useFiles+this.putFiles==0)
				diag.push(new vscode.Diagnostic(rng,'global label is undefined',vscode.DiagnosticSeverity.Error));
			else if (curr.type=='local_label' && !this.labels.locals.has(localLabelExt))
				diag.push(new vscode.Diagnostic(rng,'local label is not defined in this scope',vscode.DiagnosticSeverity.Error));
			else if (is_var && !this.labels.vars.has(curr.text) && this.useFiles+this.putFiles>0)
				diag.push(new vscode.Diagnostic(rng,'variable might be undefined',vscode.DiagnosticSeverity.Warning));
			else if (is_var && !this.labels.vars.has(curr.text) && this.useFiles+this.putFiles==0)
				diag.push(new vscode.Diagnostic(rng,'variable is undefined',vscode.DiagnosticSeverity.Error));
			else if (is_var && !this.labels.runningVars.has(curr.text) && this.useFiles+this.putFiles>0)
				diag.push(new vscode.Diagnostic(rng,'variable might be forward referenced',vscode.DiagnosticSeverity.Warning));
			else if (is_var && !this.labels.runningVars.has(curr.text) && this.useFiles+this.putFiles==0)
				diag.push(new vscode.Diagnostic(rng,'variable is forward referenced',vscode.DiagnosticSeverity.Warning));
			if (count<diag.length)
				return;
		}
		else if (parent && parent.type=='label_def')
		{
			if (curr.type=='global_label')
				this.currScope = curr.text;
			else if (curr.type=='local_label')
			{
				if (this.currScope=='')
					diag.push(new vscode.Diagnostic(rng,'no global scope defined yet',vscode.DiagnosticSeverity.Error));
				const next = parent.nextNamedSibling;
				if (next && (next.type=='psop_mac' || next.type=='psop_ent' || next.type=='psop_ext' || next.type=='psop_equ'))
					diag.push(new vscode.Diagnostic(rng,'cannot use local label for ' + next.text,vscode.DiagnosticSeverity.Error));
				if (this.inMacro)
					diag.push(new vscode.Diagnostic(rng,'cannot use local labels in a macro',vscode.DiagnosticSeverity.Error));
			}
			else if (curr.type=='var_label')
				this.labels.runningVars.add(curr.text);
		}
	}
}

// Apparently no standard provider, so make one up
export class TSDiagnosticProvider extends lxbase.LangExtBase
{
	procSentry : ProcessorModeSentry;
	psopSentry : PseudoOpSentry;
	labelSentry : LabelSentry;
	diag : Array<vscode.Diagnostic>;
	constructor(TSInitResult : [Parser,Parser.Language,Parser.Language,boolean])
	{
		super(TSInitResult);
		this.procSentry = new ProcessorModeSentry(this.merlinVersion);
		this.psopSentry = new PseudoOpSentry(this.merlinVersion);
		this.labelSentry = new LabelSentry(this.opExactPattern,this.psopExactPattern);
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
		this.psopSentry.visit(this.diag,curs,rng);
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
		if (curs.currentNode().type=='num_str_prefix' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'numerical string prefix requires Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		if (curs.currentNode().type=='braced_aexpr' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'braced expressions require Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		if (curs.currentNode().type.substring(0,4)=="cop_" && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'operator requires Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		if (curs.currentNode().type=="dstring" && this.merlinVersion=='v32')
		{
			const delim = curs.nodeText.charAt(0);
			if (delim!='"' && delim!="'")
				this.diag.push(new vscode.Diagnostic(rng,'Merlin 32 strings use either single or double quotes',vscode.DiagnosticSeverity.Error));
		}
		if (curs.currentNode().type=="trailing" && this.merlinVersion=='v32')
		{
			if (curs.nodeText.toUpperCase()!='L')
				this.diag.push(new vscode.Diagnostic(rng,'Merlin 32 may not accept trailing characters',vscode.DiagnosticSeverity.Warning));
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	update(document : vscode.TextDocument, collection: vscode.DiagnosticCollection): void
	{
		if (document && document.languageId=='merlin6502')
		{
			collection.clear();
			this.reset();
			this.diag.length = 0;
			this.GetLabels(document); // must precede new LabelSentry
			if (this.get_interpretation(document)=='linker')
				return;
			this.labelSentry = new LabelSentry(this.opExactPattern,this.psopExactPattern);
			this.psopSentry = new PseudoOpSentry(this.merlinVersion);
			this.procSentry = new ProcessorModeSentry(this.merlinVersion);
			// first pass gathers labels again, redundancy could perhaps be eliminated
			for (this.row=0;this.row<document.lineCount;this.row++)
			{
				const tree = this.parse(this.AdjustLine(document),"\n");
				this.walk(tree,this.visit_gather.bind(this));
			}
			// second pass builds diagnostics
			this.labelSentry.reset();
			for (this.row=0;this.row<document.lineCount;this.row++)
			{
				const tree = this.parse(this.AdjustLine(document),"\n");
				this.walk(tree,this.visit_verify.bind(this));
			}
			collection.set(document.uri, this.diag);
		}
	}
}