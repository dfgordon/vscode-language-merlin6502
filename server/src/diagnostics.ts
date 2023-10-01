import * as vsserv from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';
import { MerlinContext } from './workspace';
import * as opcodes from './opcodes.json';
import * as pseudo from './pseudo_opcodes.json';
import * as labels from './labels';

export class DiagnosticSet
{
	map = new Map<string, Array<vsserv.Diagnostic>>();
	curr: Array<vsserv.Diagnostic> | undefined = undefined;
	reset() {
		this.map = new Map<string, Array<vsserv.Diagnostic>>();
	}
	set_doc(doc: vsserv.TextDocumentItem) {
		if (this.map.has(doc.uri)) {
			this.curr = this.map.get(doc.uri);
		} else {
			this.map.set(doc.uri, new Array<vsserv.Diagnostic>());
			this.curr = this.map.get(doc.uri);
		}
	}
	add(diag: vsserv.Diagnostic) {
		if (this.curr)
			this.curr.push(diag);
	}
}

class ProcessorModeSentry
{
	context: MerlinContext;
	// XC data is maintained independently of context
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
	constructor(ctx: MerlinContext)
	{
		this.context = ctx;
		this.reset(ctx.merlinVersion);
	}
	reset(merlinVersion: string)
	{
		this.xcAppearances = 0;
		if (merlinVersion=='v8')
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
	context: MerlinContext;
	psops = Object(pseudo);
	defFound = false;
	orgFound = false;
	relFound = false;
	opFound = false;
	constructor(ctx: MerlinContext)
	{
		this.context = ctx;
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
			if (psopInfo && !psopInfo.includes(this.context.merlinVersion))
			{
				diag.push(vsserv.Diagnostic.create(rng,'macro name matches a disabled pseudo-op',vsserv.DiagnosticSeverity.Information));
				return;
			}
		}

		if (curr.type.substring(0, 5) == 'psop_') {
			const psopInfo = this.psops[curr.text.toLowerCase()];
			let s = undefined;
			if (this.context.merlinVersion == 'v8')
				s = psopInfo?.v8x;
			if (this.context.merlinVersion == 'v16')
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

class GeneralSyntaxSentry
{
	context: MerlinContext;
	constructor(ctx: MerlinContext)
	{
		this.context = ctx;
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
	visit(diag: Array<vsserv.Diagnostic>,curs: Parser.TreeCursor,rng: vsserv.Range)
	{
		const merlinVersion = this.context.merlinVersion;
		const maxLabLen = merlinVersion=='v8' ? 13 : 26;
		const maxc3c4Len = merlinVersion=='v8' ? 64 : 80;
		const dstring_psops = ['psop_asc','psop_dci','psop_inv','psop_fls','psop_rev','psop_str','psop_strl']
		if (curs.currentNode().hasError())
		{
			if (!this.is_error_inside(curs.currentNode()))
				diag.push(vsserv.Diagnostic.create(rng,'syntax error:\n'+curs.currentNode().toString(),vsserv.DiagnosticSeverity.Error));
		}
		else if (["global_label","local_label","var_label"].includes(curs.nodeType))
		{
			if (curs.currentNode().text.length > maxLabLen && merlinVersion!='v32')
				diag.push(vsserv.Diagnostic.create(rng,"label is too long (max = "+maxLabLen+")",vsserv.DiagnosticSeverity.Error));
		}
		else if (this.context.config.case.caseSensitive && (curs.nodeType.substring(0,3)=='op_' || curs.nodeType.substring(0,5)=='psop_'))
		{
			if (curs.nodeText != curs.nodeText.toUpperCase())
				diag.push(vsserv.Diagnostic.create(rng,'settings require uppercase mnemonics',vsserv.DiagnosticSeverity.Error));
		}
		else if (curs.nodeType == "imm_prefix" && curs.nodeText.includes('^') && merlinVersion == 'v8')
			diag.push(vsserv.Diagnostic.create(rng, "bank byte requires Merlin 16/16+/32", vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType == "addr_prefix" && merlinVersion == 'v8')
			diag.push(vsserv.Diagnostic.create(rng, "address prefix requires Merlin 16/16+/32", vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=='num_str_prefix' && (merlinVersion=='v8' || merlinVersion=='v16'))
			diag.push(vsserv.Diagnostic.create(rng,'numerical string prefix requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=='braced_aexpr' && (merlinVersion=='v8' || merlinVersion=='v16'))
			diag.push(vsserv.Diagnostic.create(rng,'braced expressions require Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType.substring(0,4)=="cop_" && (merlinVersion=='v8' || merlinVersion=='v16'))
			diag.push(vsserv.Diagnostic.create(rng,'operator requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		else if (curs.nodeType=="dstring" && merlinVersion=='v32')
		{
			const delim = curs.nodeText.charAt(0);
			if (delim!='"' && delim!="'")
				diag.push(vsserv.Diagnostic.create(rng,'Merlin 32 strings use either single or double quotes',vsserv.DiagnosticSeverity.Error));
		}
		else if (curs.nodeType=="trailing" && merlinVersion=='v32')
		{
			if (curs.nodeText.toUpperCase()!='L')
				diag.push(vsserv.Diagnostic.create(rng,'Merlin 32 may not accept trailing characters',vsserv.DiagnosticSeverity.Warning));
		}
		else if (curs.nodeType=="comment" && merlinVersion!='v32')
		{
			// there is a limit on the combined length of the third and fourth columns.
			const c3 = curs.currentNode().previousNamedSibling;
			if (c3 && c3.type.slice(0,4)=="arg_" && c3.text.length + curs.currentNode().text.length > maxc3c4Len)
				diag.push(vsserv.Diagnostic.create(rng,'columns 3 and 4 together are too long (max = '+maxc3c4Len+')',vsserv.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.gotoSibling;
		}
		else if (curs.nodeType=="heading" && curs.nodeText.length > 64 && merlinVersion!='v32')
		{
			diag.push(vsserv.Diagnostic.create(rng,'comment is too long (max = 64)',vsserv.DiagnosticSeverity.Error))
			return lxbase.WalkerOptions.exit;
		}
		else if (curs.nodeType=="filename")
		{
			const child = curs.currentNode().firstChild;
			if (child && child.type=="dos33")
				diag.push(vsserv.Diagnostic.create(rng,'name is valid for DOS 3.3, but not ProDOS',vsserv.DiagnosticSeverity.Warning));
		}
	
		// these may coincide with previous node types, so must be outside else if sequence
		if (curs.nodeType.slice(0,4)=='arg_' && curs.nodeText.length > maxc3c4Len && merlinVersion!='v32')
		{
			diag.push(vsserv.Diagnostic.create(rng, 'column 3 is too long (max = ' + maxc3c4Len + ')', vsserv.DiagnosticSeverity.Error));
		}
		else if (dstring_psops.includes(curs.nodeType) && (merlinVersion=='v8' || merlinVersion=='v16'))
		{
			let curr = curs.currentNode().nextNamedSibling?.firstNamedChild;
			let count = 0;
			let newRng : vsserv.Range | undefined = undefined;
			while (curr) {
				const rngNow = lxbase.node_to_range(curr,this.context.row,this.context.col);
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
				diag.push(vsserv.Diagnostic.create(newRng,'extended string operand requires Merlin 16+/32',vsserv.DiagnosticSeverity.Error));
		}
		else if (curs.nodeType == 'arg_literal' || curs.nodeType == 'literal') {
			diag.push(vsserv.Diagnostic.create(rng, 'uninterpreted literal', vsserv.DiagnosticSeverity.Information));
		}
	}
}

export class DiagnosticProvider
{
	lastUpdate : number;
	lastTimeToSolution : number;
	procSentry : ProcessorModeSentry;
	psopSentry: PseudoOpSentry;
	generalSentry: GeneralSyntaxSentry;
	labelSentry: labels.LabelSentry;
	context: MerlinContext;
	diag : DiagnosticSet;
	busy : boolean;
	constructor(sentry: labels.LabelSentry)
	{
		// TODO: diagnostic set should perhaps be owned by this?
		this.diag = sentry.diag;
		this.context = sentry.context;
		this.procSentry = new ProcessorModeSentry(this.context);
		this.psopSentry = new PseudoOpSentry(this.context);
		this.generalSentry = new GeneralSyntaxSentry(this.context);
		this.labelSentry = sentry;
		this.busy = false;
		this.lastUpdate = 0;
		this.lastTimeToSolution = 1000;
	}
	visit_verify(curs: Parser.TreeCursor): lxbase.WalkerChoice
	{
		const currDoc = this.context.stack.doc[this.context.stack.doc.length - 1];
		const rng = lxbase.curs_to_range(curs, this.context.row, this.context.col);
		this.diag.set_doc(currDoc);
		if (this.diag.curr) {
			this.procSentry.visit(this.diag.curr, curs, rng);
			this.psopSentry.visit(this.diag.curr, curs, rng);
			this.generalSentry.visit(this.diag.curr, curs, rng);
			if (curs.nodeType == "psop_use" || curs.nodeType == "psop_put")
			{
				const currCtx = this.context.stack.ctx[this.context.stack.ctx.length - 1];
				const psop = curs.nodeType.substring(5, 8).toUpperCase();
				if (currCtx == lxbase.SourceOptions.master)
					return lxbase.WalkerOptions.gotoInclude;
			}
		}
		return lxbase.WalkerOptions.gotoChild;
	}
	update(displayDoc : vsserv.TextDocumentItem): DiagnosticSet
	{
		this.diag.reset();
		if (displayDoc && displayDoc.languageId=='merlin6502')
		{
			// the labelSentry carries out its own passes through the tree
			this.labelSentry.build_main(displayDoc,this.context);
			this.labelSentry.verify_main(displayDoc,this.context);
			this.diag = this.labelSentry.diag;
			// other sentries merely provide visit functions for the final pass
			this.psopSentry = new PseudoOpSentry(this.context);
			this.procSentry = new ProcessorModeSentry(this.context);
			this.generalSentry = new GeneralSyntaxSentry(this.context);
			const macros = this.labelSentry.runningMacros;
			this.context.analyze(displayDoc, macros, this.visit_verify.bind(this));
		}
		return this.diag;
	}
}