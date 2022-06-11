import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as labels from './labels';

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
		const req = this.xcCount == 0 ? '6502' : '65c02';
		// no need to check for disabled instructions since it will be a macro and flagged here
		if (curr.type=='label_ref' && curs.currentFieldName()=='mac')
		{
			const opInfo= this.ops[curr.text.toLowerCase()]?.processors;
			if (opInfo && !opInfo.includes(req))
				diag.push(new vscode.Diagnostic(rng,'macro name matches a disabled instruction',vscode.DiagnosticSeverity.Information));
			return;
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
	defFound = false;
	orgFound = false;
	relFound = false;
	opFound = false;
	constructor(merlinVersion: string)
	{
		this.merlinVersion = merlinVersion;
	}
	visit(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor,rng: vscode.Range)
	{
		const curr = curs.currentNode();
		const prev = curr.previousSibling;

		// ordering of conditionals is supposed to promote efficiency

		if (curr.type == "label_def")
			this.defFound = true;
		else if (curr.type=="operation")
			this.opFound = true;
		else if (curr.type.substring(0, 5) == 'psop_')
		{
			const abv = curr.type.substring(5);
			if (abv == "equ")
			{
				if (!prev)
					diag.push(new vscode.Diagnostic(rng, 'must provide label', vscode.DiagnosticSeverity.Error));
			}
			else if (abv == "org")
			{
				if (this.relFound)
					diag.push(new vscode.Diagnostic(rng,'REL and ORG should not appear in the same file'));
				this.orgFound = true;
			}
			else if (abv == "rel")
			{
				if (this.orgFound)
					diag.push(new vscode.Diagnostic(rng,'REL and ORG should not appear in the same file'));
				if (this.defFound)
					diag.push(new vscode.Diagnostic(rng,'REL appears after one or more label definitions'));			
				this.relFound = true;
			}
			else if (abv == "obj")
			{
				if (this.opFound)
					diag.push(new vscode.Diagnostic(rng, 'OBJ should not appear after start of code'));
			}
			else if (abv=="ext" || abv=="exd" || abv=="ent")
			{
				const operand = curr.nextNamedSibling && curr.nextNamedSibling.type!="comment";
				if (prev && operand)
					diag.push(new vscode.Diagnostic(rng,'use either column 1 or 3 for the label(s), not both',vscode.DiagnosticSeverity.Error));
				if (!prev && !operand)
					diag.push(new vscode.Diagnostic(rng,'must provide label(s) in either column 1 or 3',vscode.DiagnosticSeverity.Error));
			}
			// no need to check for disabled pseudo-op since it will be interpreted as a macro and flagged below
		}
		else if (curr.type=='label_ref' && curs.currentFieldName()=='mac')
		{
			const psopInfo = this.psops[curr.text.toLowerCase()]?.version;
			if (psopInfo && !psopInfo.includes(this.merlinVersion))
			{
				diag.push(new vscode.Diagnostic(rng,'macro name matches a disabled pseudo-op',vscode.DiagnosticSeverity.Information));
				return;
			}
		}

		if (prev && prev.type.substring(0, 5) == 'psop_')
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

// Apparently no standard provider, so make one up
export class TSDiagnosticProvider extends lxbase.LangExtBase
{
	lastUpdate : number;
	lastTimeToSolution : number;
	procSentry : ProcessorModeSentry;
	psopSentry : PseudoOpSentry;
	labelSentry : labels.LabelSentry;
	diag = Array<vscode.Diagnostic>();
	busy : boolean;
	constructor(TSInitResult : [Parser,Parser.Language],sentry: labels.LabelSentry)
	{
		super(TSInitResult);
		this.procSentry = new ProcessorModeSentry(this.merlinVersion);
		this.psopSentry = new PseudoOpSentry(this.merlinVersion);
		this.labelSentry = sentry;
		this.busy = false;
		this.lastUpdate = 0;
		this.lastTimeToSolution = 1000;
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
	visit_verify(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const maxLabLen = this.merlinVersion=='v8' ? 13 : 26;
		const maxc3c4Len = this.merlinVersion=='v8' ? 64 : 80;
		const dstring_psops = ['psop_asc','psop_dci','psop_inv','psop_fls','psop_rev','psop_str','psop_strl']
		const rng = this.curs_to_range(curs,this.row,this.col);
		this.procSentry.visit(this.diag,curs,rng);
		this.psopSentry.visit(this.diag,curs,rng);
		if (curs.currentNode().hasError())
		{
			if (!this.is_error_inside(curs.currentNode()))
				this.diag.push(new vscode.Diagnostic(rng,'syntax error:\n'+curs.currentNode().toString(),vscode.DiagnosticSeverity.Error));
		}
		else if (["global_label","local_label","var_label"].includes(curs.currentNode().type))
		{
			if (curs.currentNode().text.length > maxLabLen && this.merlinVersion!='v32')
				this.diag.push(new vscode.Diagnostic(rng,"label is too long (max = "+maxLabLen+")",vscode.DiagnosticSeverity.Error));
		}
		else if (this.caseSens && (curs.currentNode().type.substring(0,3)=='op_' || curs.currentNode().type.substring(0,5)=='psop_'))
		{
			if (curs.nodeText != curs.nodeText.toUpperCase())
				this.diag.push(new vscode.Diagnostic(rng,'settings require uppercase mnemonics',vscode.DiagnosticSeverity.Error));
		}
		else if (curs.currentNode().type=='num_str_prefix' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'numerical string prefix requires Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		else if (curs.currentNode().type=='braced_aexpr' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'braced expressions require Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		else if (curs.currentNode().type.substring(0,4)=="cop_" && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(new vscode.Diagnostic(rng,'operator requires Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		else if (curs.currentNode().type=="dstring" && this.merlinVersion=='v32')
		{
			const delim = curs.nodeText.charAt(0);
			if (delim!='"' && delim!="'")
				this.diag.push(new vscode.Diagnostic(rng,'Merlin 32 strings use either single or double quotes',vscode.DiagnosticSeverity.Error));
		}
		else if (curs.currentNode().type=="trailing" && this.merlinVersion=='v32')
		{
			if (curs.nodeText.toUpperCase()!='L')
				this.diag.push(new vscode.Diagnostic(rng,'Merlin 32 may not accept trailing characters',vscode.DiagnosticSeverity.Warning));
		}
		else if (curs.currentNode().type=="comment" && this.merlinVersion!='v32')
		{
			// there is a limit on the combined length of the third and fourth columns.
			const c3 = curs.currentNode().parent?.childForFieldName('c3');
			if (c3 && c3.text.length + curs.currentNode().text.length > maxc3c4Len)
				this.diag.push(new vscode.Diagnostic(rng,'columns 3 and 4 together are too long (max = '+maxc3c4Len+')',vscode.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (curs.currentNode().type=="main_comment" && curs.nodeText.length > 64 && this.merlinVersion!='v32')
		{
			this.diag.push(new vscode.Diagnostic(rng,'comment is too long (max = 64)',vscode.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.exit;
		}
		else if (curs.currentNode().type=="filename")
		{
			const child = curs.currentNode().firstChild;
			if (child && child.type=="dos33")
				this.diag.push(new vscode.Diagnostic(rng,'name is valid for DOS 3.3, but not ProDOS',vscode.DiagnosticSeverity.Warning));
		}
	
		// these may coincide with previous node types, so must be outside else if sequence
		if (curs.currentFieldName()=='c3' && curs.nodeText.length > maxc3c4Len && this.merlinVersion!='v32')
		{
			this.diag.push(new vscode.Diagnostic(rng,'column 3 is too long (max = '+maxc3c4Len+')',vscode.DiagnosticSeverity.Error))
		}
		else if (dstring_psops.includes(curs.currentNode().type) && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
		{
			let curr = curs.currentNode().nextNamedSibling;
			let count = 0;
			let newRng : vscode.Range | undefined = undefined;
			while (curr) {
				const rngNow = this.node_to_range(curr,this.row,this.col);
				if (curr.type=='dstring' || curr.type=='hex_data')
				{
					if (newRng)
						newRng = newRng.union(rngNow);
					else
						newRng = rngNow; 
					count++;
				}
				curr = curr.nextNamedSibling;
			}
			if (count>2 && newRng)
				this.diag.push(new vscode.Diagnostic(newRng,'extended string operand requires Merlin 16+/32',vscode.DiagnosticSeverity.Error));
		}

		return lxbase.WalkerOptions.gotoChild;
	}
	update(document : vscode.TextDocument,
		collection: vscode.DiagnosticCollection,
		versionIndicator: vscode.StatusBarItem,
		typeIndicator: vscode.StatusBarItem,
		force: boolean)
	{
		const startTime = new Date().getTime();
		if (!force && (this.busy || startTime<this.lastUpdate + this.lastTimeToSolution))
			return;				
		if (document && document.languageId=='merlin6502')
		{
			this.lastUpdate = startTime;
			this.busy = true;
			this.reset();
			this.GetProperties(document);
			typeIndicator.text = this.get_interpretation(document);
			if (typeIndicator.text=='source')
			{
				// the labelSentry carries out its own passes through the tree
				this.labelSentry.build_main(document);
				this.labelSentry.shared = this.labelSentry.labels;
				this.labelSentry.verify_main(document);
				this.diag = this.labelSentry.diag;
				// other sentries merely provide visit functions for the final pass
				this.psopSentry = new PseudoOpSentry(this.merlinVersion);
				this.procSentry = new ProcessorModeSentry(this.merlinVersion);
				for (this.row=0;this.row<document.lineCount;this.row++)
				{
					const tree = this.parse(this.AdjustLine(document,this.labelSentry.labels.macros),"\n");
					this.walk(tree,this.visit_verify.bind(this));
				}
				collection.set(document.uri, this.diag);
			}
			else
			{
				this.labelSentry.labels = new labels.LabelSet();
				this.labelSentry.shared = this.labelSentry.labels;
			}
			versionIndicator.show();
			typeIndicator.show();
			this.lastTimeToSolution = 3*(new Date().getTime() - startTime);
			this.busy = false;
		}
	}
}