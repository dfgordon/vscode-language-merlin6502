import * as vsserv from 'vscode-languageserver';
import * as vsdoc from 'vscode-languageserver-textdocument';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as labels from './labels';
import { merlin6502Settings } from './settings';

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
	visit(diag: Array<vsserv.Diagnostic>,curs: Parser.TreeCursor,rng: vsserv.Range)
	{
		const curr = curs.currentNode();
		const parent = curr.parent;
		const next = curr.nextSibling;
		if (parent && parent.type=='source_file' && curr.type!="heading")
			this.programLine += 1;
		if (curr.type=='psop_xc')
		{
			this.xcAppearances += 1;
			if (this.xcAppearances!=this.programLine)
				diag.push(vsserv.Diagnostic.create(rng,'XC pseudo-ops must appear first and be uninterrupted',vsserv.DiagnosticSeverity.Error));
			if (next && next.text.toUpperCase()=='OFF')
				this.xcCount = 0;
			else
				this.xcCount += 1;
			if (this.xcCount>2)
			{
				this.xcCount = 2;
				diag.push(vsserv.Diagnostic.create(rng,'this would cause the XC count to exceed 2',vsserv.DiagnosticSeverity.Error));
			}
			return;
		}
		if (this.xcCount==2) // all modes are valid so exit now
			return;
		const req = this.xcCount == 0 ? '6502' : '65c02';
		// no need to check for disabled instructions since it will be a macro and flagged here
		if (curr.type=='macro_ref')
		{
			const opInfo= this.ops[curr.text.toLowerCase()]?.processors;
			if (opInfo && !opInfo.includes(req))
				diag.push(vsserv.Diagnostic.create(rng,'macro name matches a disabled instruction',vsserv.DiagnosticSeverity.Information));
			return;
		}
		if (curr.type.slice(0,4)=='arg_' && curr.firstNamedChild)
		{
			const availModes = this.modeMap[curr.firstNamedChild.type];
			if (!availModes)
				return;
			const modeList = this.ops[curr.type.substring(4, 7).toLowerCase()]?.modes;
			if (!modeList)
				return;
			for (const mode of modeList)
			{
				const procOK = mode.processors.includes(req);
				const availOK = availModes.includes(mode.addr_mnemonic);
				if (procOK && availOK)
					return;
			}
			if (parent && !parent.hasError())
				diag.push(vsserv.Diagnostic.create(rng,'addressing mode disabled, use XC pseudo-op to enable',vsserv.DiagnosticSeverity.Error));
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
	visit(diag: Array<vsserv.Diagnostic>,curs: Parser.TreeCursor,rng: vsserv.Range)
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
					diag.push(vsserv.Diagnostic.create(rng, 'must provide label', vsserv.DiagnosticSeverity.Error));
			}
			else if (abv == "org")
			{
				if (this.relFound)
					diag.push(vsserv.Diagnostic.create(rng,'REL and ORG should not appear in the same file'));
				this.orgFound = true;
			}
			else if (abv == "rel")
			{
				if (this.orgFound)
					diag.push(vsserv.Diagnostic.create(rng,'REL and ORG should not appear in the same file'));
				if (this.defFound)
					diag.push(vsserv.Diagnostic.create(rng,'REL appears after one or more label definitions'));			
				this.relFound = true;
			}
			else if (abv == "obj")
			{
				if (this.opFound)
					diag.push(vsserv.Diagnostic.create(rng, 'OBJ should not appear after start of code'));
			}
			else if (abv=="ext" || abv=="exd" || abv=="ent")
			{
				const operand = curr.nextNamedSibling && curr.nextNamedSibling.type!="comment";
				if (prev && operand)
					diag.push(vsserv.Diagnostic.create(rng,'use either column 1 or 3 for the label(s), not both',vsserv.DiagnosticSeverity.Error));
				if (!prev && !operand)
					diag.push(vsserv.Diagnostic.create(rng,'must provide label(s) in either column 1 or 3',vsserv.DiagnosticSeverity.Error));
			}
			// no need to check for disabled pseudo-op since it will be interpreted as a macro and flagged below
		}
		else if (curr.type=='macro_ref')
		{
			const psopInfo = this.psops[curr.text.toLowerCase()]?.version;
			if (psopInfo && !psopInfo.includes(this.merlinVersion))
			{
				diag.push(vsserv.Diagnostic.create(rng,'macro name matches a disabled pseudo-op',vsserv.DiagnosticSeverity.Information));
				return;
			}
		}

		if (curr.type.substring(0, 5) == 'psop_') {
			const psopInfo = this.psops[curr.text.toLowerCase()];
			let s = undefined;
			if (this.merlinVersion == 'v8')
				s = psopInfo?.v8x;
			if (this.merlinVersion == 'v16')
				s = psopInfo?.v16x;
			if (s) {
				const patt = RegExp(s.substring(1, s.length - 1), 'i');
				let next = curr.nextNamedSibling?.firstNamedChild;
				while (next) {
					if (next.text.match(patt))
						diag.push(vsserv.Diagnostic.create(lxbase.node_to_range(next, rng.start.line, 0),
							'pseudo-op argument is disabled for the selected Merlin version', vsserv.DiagnosticSeverity.Error));
					next = next.nextNamedSibling;
				}
			}
		}
	}
}

export class TSDiagnosticProvider extends lxbase.LangExtBase
{
	lastUpdate : number;
	lastTimeToSolution : number;
	procSentry : ProcessorModeSentry;
	psopSentry : PseudoOpSentry;
	labelSentry : labels.LabelSentry;
	diag = Array<vsserv.Diagnostic>();
	busy : boolean;
	constructor(TSInitResult : [Parser,Parser.Language],settings: merlin6502Settings, sentry: labels.LabelSentry)
	{
		super(TSInitResult,settings);
		this.procSentry = new ProcessorModeSentry(this.merlinVersion);
		this.psopSentry = new PseudoOpSentry(this.merlinVersion);
		this.labelSentry = sentry;
		this.busy = false;
		this.lastUpdate = 0;
		this.lastTimeToSolution = 1000;
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
		const rng = lxbase.curs_to_range(curs,this.row,this.col);
		this.procSentry.visit(this.diag,curs,rng);
		this.psopSentry.visit(this.diag,curs,rng);
		if (curs.currentNode().hasError())
		{
			if (!this.is_error_inside(curs.currentNode()))
				this.diag.push(vsserv.Diagnostic.create(rng,'syntax error:\n'+curs.currentNode().toString(),vsserv.DiagnosticSeverity.Error));
		}
		else if (["global_label","local_label","var_label"].includes(curs.nodeType))
		{
			if (curs.currentNode().text.length > maxLabLen && this.merlinVersion!='v32')
				this.diag.push(vsserv.Diagnostic.create(rng,"label is too long (max = "+maxLabLen+")",vsserv.DiagnosticSeverity.Error));
		}
		else if (this.config.case.caseSensitive && (curs.nodeType.substring(0,3)=='op_' || curs.nodeType.substring(0,5)=='psop_'))
		{
			if (curs.nodeText != curs.nodeText.toUpperCase())
				this.diag.push(vsserv.Diagnostic.create(rng,'settings require uppercase mnemonics',vsserv.DiagnosticSeverity.Error));
		}
		else if (curs.nodeType == "imm_prefix" && curs.nodeText.includes('^') && this.merlinVersion == 'v8')
			this.diag.push(vsserv.Diagnostic.create(rng, "bank byte requires Merlin 16/16+/32", vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType == "addr_prefix" && this.merlinVersion == 'v8')
			this.diag.push(vsserv.Diagnostic.create(rng, "address prefix requires Merlin 16/16+/32", vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=='num_str_prefix' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(vsserv.Diagnostic.create(rng,'numerical string prefix requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=='braced_aexpr' && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(vsserv.Diagnostic.create(rng,'braced expressions require Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType.substring(0,4)=="cop_" && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
			this.diag.push(vsserv.Diagnostic.create(rng,'operator requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=="dstring" && this.merlinVersion=='v32')
		{
			const delim = curs.nodeText.charAt(0);
			if (delim!='"' && delim!="'")
				this.diag.push(vsserv.Diagnostic.create(rng,'Merlin 32 strings use either single or double quotes',vsserv.DiagnosticSeverity.Error));
		}
		else if (curs.nodeType=="trailing" && this.merlinVersion=='v32')
		{
			if (curs.nodeText.toUpperCase()!='L')
				this.diag.push(vsserv.Diagnostic.create(rng,'Merlin 32 may not accept trailing characters',vsserv.DiagnosticSeverity.Warning));
		}
		else if (curs.nodeType=="comment" && this.merlinVersion!='v32')
		{
			// there is a limit on the combined length of the third and fourth columns.
			const c3 = curs.currentNode().previousNamedSibling;
			if (c3 && c3.type.slice(0,4)=="arg_" && c3.text.length + curs.currentNode().text.length > maxc3c4Len)
				this.diag.push(vsserv.Diagnostic.create(rng,'columns 3 and 4 together are too long (max = '+maxc3c4Len+')',vsserv.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (curs.nodeType=="heading" && curs.nodeText.length > 64 && this.merlinVersion!='v32')
		{
			this.diag.push(vsserv.Diagnostic.create(rng,'comment is too long (max = 64)',vsserv.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.exit;
		}
		else if (curs.nodeType=="filename")
		{
			const child = curs.currentNode().firstChild;
			if (child && child.type=="dos33")
				this.diag.push(vsserv.Diagnostic.create(rng,'name is valid for DOS 3.3, but not ProDOS',vsserv.DiagnosticSeverity.Warning));
		}
	
		// these may coincide with previous node types, so must be outside else if sequence
		if (curs.nodeType.slice(0,4)=='arg_' && curs.nodeText.length > maxc3c4Len && this.merlinVersion!='v32')
		{
			this.diag.push(vsserv.Diagnostic.create(rng,'column 3 is too long (max = '+maxc3c4Len+')',vsserv.DiagnosticSeverity.Error))
		}
		else if (dstring_psops.includes(curs.nodeType) && (this.merlinVersion=='v8' || this.merlinVersion=='v16'))
		{
			let curr = curs.currentNode().nextNamedSibling?.firstNamedChild;
			let count = 0;
			let newRng : vsserv.Range | undefined = undefined;
			while (curr) {
				const rngNow = lxbase.node_to_range(curr,this.row,this.col);
				if (curr.type=='dstring' || curr.type=='hex_data')
				{
					if (newRng)
						newRng = lxbase.rangeUnion(newRng,rngNow);
					else
						newRng = rngNow; 
					count++;
				}
				curr = curr.nextNamedSibling;
			}
			if (count>2 && newRng)
				this.diag.push(vsserv.Diagnostic.create(newRng,'extended string operand requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		}

		return lxbase.WalkerOptions.gotoChild;
	}
	update(document : vsdoc.TextDocument): Array<vsserv.Diagnostic>
	{
		this.diag = new Array<vsserv.Diagnostic>();
		if (document && document.languageId=='merlin6502')
		{
			const lines = document.getText().split('\n');
			this.reset();
			this.GetProperties(lines);
			if (this.interpretation=='source')
			{
				// the labelSentry carries out its own passes through the tree
				this.labelSentry.build_main(document);
				this.labelSentry.verify_main(document);
				this.diag = this.labelSentry.diag;
				// other sentries merely provide visit functions for the final pass
				this.psopSentry = new PseudoOpSentry(this.merlinVersion);
				this.procSentry = new ProcessorModeSentry(this.merlinVersion);
				const macros = this.labelSentry.shared.get(document.uri)?.macros;
				if (macros)
					for (this.row=0;this.row<lines.length;this.row++)
					{
						const tree = this.parse(this.AdjustLine(lines,macros),"\n");
						this.walk(tree,this.visit_verify.bind(this));
					}
			}
		}
		return this.diag;
	}
}