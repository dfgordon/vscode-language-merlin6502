import * as vsserv from 'vscode-languageserver/node';
import * as vsdoc from 'vscode-languageserver-textdocument';
import * as path from 'path';
import Parser, { TreeCursor } from 'web-tree-sitter';
import { LabelNode, AddLabel } from './labels';
import * as lxbase from './langExtBase';
import * as vsuri from 'vscode-uri';
import { globSync } from 'glob';
import * as fs from 'fs';

/** make the path relative to the workspace root */
export function relativeToWorkspace(dirs: vsserv.WorkspaceFolder[], uri: string): string {
	const base = dirs.length > 0 ? dirs[0].uri : undefined;
	return base ? uri.replace(base, '').substring(1) : uri;
}

/**
 * Stack for descending into includes
 */
export class AnalysisStack {
	row = new Array<number>();
	col = new Array<number>();
	ctx = new Array<lxbase.SourceType>();
	doc = new Array<vsserv.TextDocumentItem>();
}

/**
 * Keep scanner info separate in case the workspace
 * scan ever runs in parallel with the context analysis.
 */
class Scanner {
	row = 0;
	col = 0;
	doc: vsserv.TextDocumentItem | null = null;
}

export class MerlinContext extends lxbase.LangExtBase {
	/** analysis visitors can get the current document info from here */
	stack = new AnalysisStack;
	/** scanning visitors can get the current document info from here */
	scanner = new Scanner;
	/** visit function to call during analysis, usually passed into main analyzer function */
	visitor: ((curs: TreeCursor) => lxbase.WalkerChoice) | null = null;
	/** set of running macro labels, usually passed into main analyzer function */
	macros: Set<string> | Map<string, LabelNode[]> = new Set<string>();
	/** array of folders in this workspace */
	folders = new Array<vsserv.WorkspaceFolder>();
	/** array of documents in this workspace */
	docs = new Array<vsserv.TextDocumentItem>();
	/** label nodes of all entries in the workspace, mapped by uri */
	entries = new Map<string, Array<LabelNode>>();
	/** map from an include file basename to all document uri that `put` it */
	put_map = new Map<string, Set<string>>();
	/** map from an include file basename to all document uri that `use` it */
	use_map = new Map<string, Set<string>>();
	/** set of uri that are included by another file */
	includes = new Set<string>();
	/** preferred master document uri */
	preferred_master: vsserv.URI | undefined;
	rescan_entries = true;
	get_put_masters(uri: string): Array<string> {
		const ans = new Array<string>();
		let master_set = undefined;
		const includeKey = path.basename(uri, ".S");
		if (this.put_map.has(includeKey))
			master_set = this.put_map.get(includeKey);
		if (master_set)
			for (const master of master_set)
				ans.push(master);
		return ans;
	}
	get_use_masters(uri: string): Array<string> {
		const ans = new Array<string>();
		let master_set = undefined;
		const includeKey = path.basename(uri, ".S");
		if (this.use_map.has(includeKey))
			master_set = this.use_map.get(includeKey);
		if (master_set)
			for (const master of master_set)
				ans.push(master);
		return ans;
	}
	/** find document's master based on what is in workspace and preference,
	 * but ignoring availability of labels and diagnostic status.
	 */
	get_master(doc: vsserv.TextDocumentItem): vsserv.TextDocumentItem {
		const includes = this.get_use_masters(doc.uri).concat(this.get_put_masters(doc.uri));
		if (includes.length == 0)
			return doc;
		let preferred = includes[0];
		for (const include of includes)
			if (this.preferred_master == include)
				preferred = this.preferred_master;
		for (const maybe_master of this.docs) {
			if (maybe_master.uri == preferred)
				return maybe_master;
		}
		return doc;
	}
	gather_docs(folders: vsserv.WorkspaceFolder[]) {
		this.docs = new Array<vsserv.TextDocumentItem>();
		for (const folder of folders) {
			const folderUri = vsuri.URI.parse(folder.uri);
			const globUri = vsuri.Utils.joinPath(folderUri, '**', '*.S');
			// TODO: reconcile the uri library with glob, in particular, glob wants us to
			// always use the forward slash (so they can escape `*` and `?`)
			const files = globSync(globUri.fsPath, { windowsPathsNoEscape: true });
			files.forEach(f => {
				const fileUri = vsuri.URI.file(f);
				const content: string = fs.readFileSync(f, { encoding: "utf8" });
				this.docs.push(vsserv.TextDocumentItem.create(fileUri.toString(), 'merlin6502', 0, content));
			});
		}
		this.folders = folders;
	}
	updateWorkspaceDocs(windowDocs: vsserv.TextDocuments<vsdoc.TextDocument>) {
		// this should be an inexpensive set of pointer updates
		for (const doc of this.docs) {
			const winDoc = windowDocs.get(doc.uri);
			if (winDoc) {
				doc.text = winDoc.getText();
				doc.version = winDoc.version;
			}
		}
	}
	/**
	 * Visitor to build information about the overall workspace.
	 * Important that this be efficient since every file is scanned.
	 */
	visit_entries_and_includes(curs: Parser.TreeCursor): lxbase.WalkerChoice {
		if (!this.scanner.doc)
			return lxbase.WalkerOptions.exit;
		// as an optimization, take swift action on certain high level nodes
		if (curs.nodeType == 'operation' || curs.nodeType == 'macro_call')
			return lxbase.WalkerOptions.exit;
		if (curs.nodeType == 'source_file')
			return lxbase.WalkerOptions.gotoChild;
		if (curs.nodeType == 'pseudo_operation')
			return lxbase.WalkerOptions.gotoChild;
		let curr = curs.currentNode();
		let next = curr.nextNamedSibling;
		// First handle entries.
		if (curr.type == 'label_def' && next && next.type == 'psop_ent') {
			AddLabel(curr.text, new LabelNode(this.scanner.doc, curr, lxbase.node_to_range(curr, this.scanner.row, this.scanner.col)), this.entries);
			return lxbase.WalkerOptions.exit;
		}
		if (curr.type == 'psop_ent') {
			let sib = curr.nextNamedSibling?.firstNamedChild;
			while (sib && sib.type == 'label_ref') {
				AddLabel(sib.text, new LabelNode(this.scanner.doc, sib, lxbase.node_to_range(sib, this.scanner.row, this.scanner.col)), this.entries);
				sib = sib.nextNamedSibling;
			}
			return lxbase.WalkerOptions.exit;
		}
		// Now check for includes.
		// If this is a label def we might as well advance the cursor.
		if (curr.type == 'label_def')
			curs.gotoNextSibling();
		curr = curs.currentNode();
		next = curr.nextNamedSibling;
		if (curr.type == 'psop_use' && next) {
			let masterFiles = this.use_map.get(next.text);
			if (!masterFiles)
				masterFiles = new Set<string>();
			masterFiles.add(this.scanner.doc.uri);
			this.use_map.set(path.posix.basename(next.text), masterFiles);
			// track all the URI that could be this include
			for (const doc of this.docs) {
				if (path.basename(doc.uri, ".S") == path.posix.basename(next.text))
					this.includes.add(doc.uri);
			}
		}
		if (curr.type == 'psop_put' && next) {
			let masterFiles = this.put_map.get(next.text);
			if (!masterFiles)
				masterFiles = new Set<string>();
			masterFiles.add(this.scanner.doc.uri);
			this.put_map.set(path.posix.basename(next.text), masterFiles);
			// track all the URI that could be this include
			for (const doc of this.docs) {
				if (path.basename(doc.uri, ".S") == path.posix.basename(next.text))
					this.includes.add(doc.uri);
			}
		}
		// If none of the above we can go straight to the next line
		return lxbase.WalkerOptions.exit;
	}
	/**
	 * scan the workspace for entries and includes
	 * @param docs array of Merlin documents in this workspace
	 */
	scan_entries_and_includes() {
		this.entries = new Map<string, Array<LabelNode>>();
		this.use_map = new Map<string, Set<string>>();
		this.put_map = new Map<string, Set<string>>();
		for (const doc of this.docs) {
			this.scanner.doc = doc;
			this.scanner.col = 0;
			const lines = doc.text.split(/\r?\n/);
			for (this.scanner.row = 0; this.scanner.row < lines.length; this.scanner.row++) {
				if (lines[this.scanner.row].search(/^\S*\s+(ENT|PUT|USE)/i) == -1)
					continue; // maybe save some time
				// TODO: deal with macros that begin with ENT,PUT,USE
				const tree = this.parse(lines[this.scanner.row], "\n");
				this.walk(tree, this.visit_entries_and_includes.bind(this), undefined);
			}
		}
		// clean the include maps so that a master cannot also be an include.
		// it is possible to end up with no masters.
		for (const include of this.includes) {
			for (const vals of this.use_map.values())
				vals.delete(include);
			for (const vals of this.put_map.values())
				vals.delete(include);
		}
		this.rescan_entries = false;
	}
	/** get possible includes based matching ProDOS path and workspace documents */
	include_candidates(curs: TreeCursor): number {
		const fileNode = curs.currentNode().nextNamedSibling;
		if (!fileNode) {
			return 0;
		}
		const fileName = path.posix.basename(fileNode.text);
		let matches = 0;
		for (const doc of this.docs) {
			const docName = path.basename(doc.uri, '.S');
			if (docName == fileName)
				matches++;
		}
		return matches;
	}
	/**
	 * Helper for descent callbacks
	 * @param curs expected to be on a PUT or USE pseudo-op node
	 * @member stack is grown if there is a document
	 * @returns document to descend into
	 */
	prepare_to_descend(curs: TreeCursor): vsserv.TextDocumentItem | null {
		if (this.stack.row.length > 1) {
			//this.logger.log('do not descend, recursive');
			return null;
		}
		let new_ctx: lxbase.SourceType = lxbase.SourceOptions.master;
		if (curs.nodeType == "psop_put")
			new_ctx = lxbase.SourceOptions.put;
		if (curs.nodeType == "psop_use")
			new_ctx = lxbase.SourceOptions.use;
		if (!["psop_put", "psop_use"].includes(curs.nodeType)) {
			//this.logger.log('do not descend, wrong node type ' + curs.nodeType);
			return null;
		}
		const fileNode = curs.currentNode().nextNamedSibling;
		if (!fileNode) {
			//this.logger.log('do not descend, no filename node');
			return null;
		}
		const fileName = path.posix.basename(fileNode.text);
		const matches = new Array<vsserv.TextDocumentItem>();
		for (const doc of this.docs) {
			const docName = path.basename(doc.uri, '.S');
			if (docName == fileName)
				matches.push(doc);
		}
		if (matches.length == 0) {
			//this.logger.log('do not descend, no match for ' + fileName);
			return null;
		}
		this.stack.row.push(this.row);
		this.stack.col.push(this.col);
		this.stack.doc.push(matches[0]);
		this.stack.ctx.push(new_ctx);
		return matches[0];
	}
	/**
	 * default descend function
	 * @param curs expected to be on a PUT or USE pseudo-op node
	 * @returns where to go when we return to master
	 */
	descend(curs: TreeCursor): lxbase.WalkerChoice {
		//this.logger.log('descend requested')
		const include = this.prepare_to_descend(curs);
		if (include) {
			//this.logger.log('descending into ' + include.uri);
			const lines = include.text.split(/\r?\n/);
			this.analyze_lines(lines)
			const old_row = this.stack.row.pop();
			const old_col = this.stack.col.pop();
			const old_ctx = this.stack.ctx.pop();
			const old_doc = this.stack.doc.pop();
			if (old_row != undefined && old_col != undefined && old_ctx && old_doc) {
				this.row = old_row;
				this.col = old_col;
				//this.logger.log('resume at ' + this.row + ',' + this.col);
				return lxbase.WalkerOptions.gotoSibling;
			}
			else {
				//this.logger.log('could not restore from include stack');
				return lxbase.WalkerOptions.abort;
			}
		}
		return lxbase.WalkerOptions.gotoSibling;
	}
	/**
	 * Analyze lines of a document, called by analyze_master or descend functions
	 * @member row is re-used, descend functions must restore it after calling
	 * @member visitor is setup by analyze_master
	 * @member descend is hard coded at present
	 * @member macros is setup by analyze_master
	 */
	analyze_lines(lines: string[]) {
		if (!this.visitor)
			return;
		for (this.row = 0; this.row < lines.length; this.row++) {
			const tree = this.parse(this.AdjustLine(lines, this.macros), "\n");
			this.walk(tree, this.visitor, this.descend.bind(this));
		}
	}
	/**
	 * Analyze a master document and its includes
	 * @param doc the master document, cannot be an include
	 * @param macros running set of macro labels, or completed map of macro labels to nodes
	 * @param visit visit the node, must return `gotoInclude` appropriately
	 */
	analyze_master(doc: vsserv.TextDocumentItem, macros: Set<string> | Map<string, LabelNode[]>, visit: (curs: TreeCursor) => lxbase.WalkerChoice) {
		this.reset();
		this.stack = new AnalysisStack;
		this.stack.doc.push(doc);
		this.stack.row.push(0);
		this.stack.ctx.push(lxbase.SourceOptions.master);
		this.visitor = visit;
		this.macros = macros;
		const lines = doc.text.split(/\r?\n/);
		this.GetProperties(lines); // TODO: review this, does it make sense to only look in master?
		if (this.interpretation == 'source')
			this.analyze_lines(lines);
	}
	/**
	 * Main analyze function, can pass any document
	 * @param doc any document, its master will be found if necessary
	 * @param macros running set of macro labels, or completed map of macro labels to nodes
	 * @param visit visit the node, must return `gotoInclude` appropriately
	 */
	analyze(doc: vsserv.TextDocumentItem, macros: Set<string> | Map<string, LabelNode[]>, visit: (curs: TreeCursor) => lxbase.WalkerChoice) {
		this.analyze_master(this.get_master(doc), macros, visit);
	}
}
