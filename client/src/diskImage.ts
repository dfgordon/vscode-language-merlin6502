import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import { spawn } from 'child_process';
import * as vsclnt from 'vscode-languageclient';
import { client } from './extension';
import { DisassemblyTool } from './commands';

function abortMessage() {
	vscode.window.showInformationMessage('disk image operation aborted by user');
}

/**
 * return a range that expands the selection minimally to encompass complete lines
 * @param textEditor the editor with the range to analyze
 * @returns either a range, or undefined if there was none
 */
function extended_selection(textEditor: vscode.TextEditor) : vscode.Range | undefined
{
	const sel = textEditor.selection;
	if (!sel.isEmpty)
	{
		const ext_start = new vscode.Position(sel.start.line,0);
		let ext_end = undefined;
		if (sel.end.character==0)
			ext_end = textEditor.document.lineAt(sel.end.line-1).range.end;
		else
			ext_end = textEditor.document.lineAt(sel.end.line).range.end;
		return new vscode.Range(ext_start,ext_end);
	}
	return undefined;
}

interface FileImageType {
	fimg_version: string;
	file_system: string;
	chunk_len: number;
	eof: string;
	fs_type: string;
	aux: string;
	access: string;
	created: string;
	modified: string;
	version: string;
	min_version: string;
	chunks: {[Key: string]: string};
}

class FileImage {
	img: FileImageType;
	constructor(json_str: string) {
		this.img = JSON.parse(json_str);
	}
	verify(): boolean {
		if (this.img.fimg_version.slice(0, 2) != "2.")
			return false;
		return true;
	}
	/**
	 * Analyze chunks and return sequential data if possible
	 * @returns array of numbers if data is sequential, undefined otherwise
	 */
	sequence(): number[] | undefined {
		const sorted = new Map(Object.entries(this.img.chunks).sort((a, b) => {
			return parseInt(a[0]) - parseInt(b[0])
		}));
		const ans = new Array<number>();
		let idx = 0;
		for (const [key, value] of sorted) {
			if (idx != parseInt(key)) {
				console.log("expected chunk "+idx+" got "+key)
				return;
			}
			if (value.length % 2 == 1) {
				console.log("length of hex string was odd");
				return;
			}
			for (let i = 0; i < value.length / 2; i++) {
				const byteValue = parseInt(value.slice(i * 2, i * 2 + 2), 16);
				if (isNaN(byteValue)) {
					console.log("hex string parsed as NaN");
					return;
				}
				ans.push(byteValue);
			}
			idx++;
		}
		return ans;
	}
	/**
	 * Get the load address and data of a binary file, works for either DOS or ProDOS
	 * @returns [load address,data] if file image checks as binary, undefined otherwise
	 */
	getBinary(): [number, number[]] | undefined {
		const seq = this.sequence();
		if (!seq)
			return;
		if (this.img.file_system == "a2 dos") {
			if (this.img.fs_type != "04" && this.img.fs_type != "84")
				return;
			if (seq.length < 4)
				return;
			const loadAddr = seq[0] + 256 * seq[1];
			const eof = seq[2] + 256 * seq[3];
			if (seq.length < 4 + eof)
				return;
			return [loadAddr, seq.slice(4, 4 + eof)];
		}
		if (this.img.file_system == "prodos") {
			if (this.img.fs_type != "06" && this.img.fs_type != "FF" && this.img.fs_type != "ff")
				return;
			const aux = this.img.aux;
			if (aux.length < 4)
				return;
			const loadAddr = parseInt(aux.slice(0, 2), 16) + 256 * parseInt(aux.slice(2, 4), 16);
			const eofs = this.img.eof;
			if (eofs.length < 6)
				return;
			const eof = parseInt(eofs.slice(0, 2), 16) + 256 * parseInt(eofs.slice(2, 4), 16) + 256 * 256 * parseInt(eofs.slice(4, 6), 16);
			if (isNaN(loadAddr))
				return;
			if (eof < seq.length)
				return [loadAddr, seq.slice(0, eof)];
			else
				return [loadAddr, seq];
		}
		return undefined;
	}
}

/**
 * This module works by setting up a chain of callbacks that are invoked
 * upon successful completion of an a2kit subprocess.  Each link in the chain
 * is hard coded to the next link.
 */
export class A2KitTool
{
	operation = "get";
	resultString = "";
	resultBytes: Buffer = Buffer.from("");
	fsPath = "";
	imgPath = [""]; // path for each depth traversed, volume prefix is assumed
	file_list: string[] = [];
	addr: string | undefined = undefined;
	/**
	 * Run a2kit expecting to receive binary output
	 *
	 * @param args the a2kit arguments 
	 * @param resolve the callback to run when the subprocess closes
	 * @param stdin the optional string that is piped in
	 */
	a2kit_txt2bin(args: string[], resolve: (bin: Buffer) => void, stdin: string|undefined) {
		this.resultBytes = Buffer.from("");
		const process = spawn('a2kit', args, { timeout: 10000 });
		if (stdin) {
			process.stdin.write(stdin);
			process.stdin.end();
		}
		process.stderr.on('data', async (data) => {
			vscode.window.showErrorMessage(`a2kit says ${data}`);
		});
		process.stdout.on('data', async (data) => {
			this.resultBytes = Buffer.concat([this.resultBytes,data]);
		});
		process.on('error', async (err) => {
			vscode.window.showErrorMessage("error spawning a2kit, is it installed and in the path?");
		});
		process.on('close', async (exitCode) => {
			if (exitCode == 0) {
				resolve(this.resultBytes);
			}
		});
	}
	/**
	 * Run a2kit expecting to receive text output
	 *
	 * @param args the a2kit arguments 
	 * @param resolve the callback to run when the subprocess closes
	 * @param stdin the optional binary data that is piped in
	 */
	a2kit_bin2txt(args: string[], resolve: (txt: string) => void, stdin: Buffer|undefined) {
		this.resultString = "";
		const process = spawn('a2kit', args, { timeout: 10000 });
		if (stdin) {
			process.stdin.write(stdin);
			process.stdin.end();
		}
		process.stderr.on('data', async (data) => {
			vscode.window.showErrorMessage(`a2kit says ${data}`);
		});
		process.stdout.on('data', async (data) => {
			const str_output = `${data}`;
			this.resultString += str_output;
		});
		process.on('error', async (err) => {
			vscode.window.showErrorMessage("error spawning a2kit, is it installed and in the path?");
		});
		process.on('close', async (exitCode) => {
			if (exitCode == 0) {
				resolve(this.resultString);
			}
		});
	}
	/**
	 * Parse a disk catalog to extract directories and source/binary files
	 * @param catalog the disk catalog with the file system's formatting
	 * @returns two arrays, first with directories, second with source/binary files
	 */
	parse_catalog(catalog: string): [string[], string[]] | undefined {
		const dirs = Array<string>();
		const files = Array<string>();
		const lines = catalog.split(/\r?\n/);
		if (lines.length>3 && lines[1].length>11 && lines[1].substring(0, 11) == "DISK VOLUME") {
			for (const line of lines.slice(3)) {
				if (line.length>7 && line[1] == "T") {
					files.push("(TXT)  " + line.slice(7));
				}
				if (line.length > 7 && line[1] == "B") {
					files.push("(BIN)  " + line.slice(7));
				}
			}
			return [dirs, files];
		}
		if (lines.length>5 && lines[3].length>21 && lines[3].substring(0, 21) == " NAME            TYPE") {
			for (const line of lines.slice(5)) {
				if (line.length>20 && line.substring(17,20) == "DIR") {
					dirs.push("(DIR)  "+line.slice(1,15).trim());
				}
				if (line.length>20 && line.substring(17,20) == "TXT") {
					files.push("(TXT)  "+line.slice(1,15).trim());
				}
				if (line.length>20 && line.substring(17,20) == "BIN") {
					files.push("(BIN)  "+line.slice(1,15).trim());
				}
				if (line.length>20 && line.substring(17,20) == "SYS") {
					files.push("(SYS)  "+line.slice(1,15).trim());
				}
			}
			return [dirs, files];
		}
		return undefined;
	}
	async insert_code(txt: string) {
		const verified = lxbase.verify_document();
		if (verified) {
			const r = extended_selection(verified.ed);
			let rng: vsclnt.Range | null;
			if (r)
				rng = vsclnt.Range.create(r.start, r.end);
			else
				rng = null;
			verified.ed.edit(edit => { edit.replace(verified.ed.selection, txt); });
		}
	}
	finish_put(txt: string) {
		vscode.window.showInformationMessage(this.imgPath[this.imgPath.length-1]+" saved to disk image");
	}
	async save_code(buf: Buffer) {
		this.a2kit_bin2txt(["put", "-d", this.fsPath, "-f", this.imgPath[this.imgPath.length - 1], "-t", "mtok"], this.finish_put.bind(this), buf);
	}
	check_addr(addr: string): null | string {
		const num = parseInt(addr);
		if (isNaN(num))
			return 'address should be a number';
		if (num<2049 || num>49143)
			return 'address is out of range (2049 - 49143)';
		return null;
	}
	async tokenize(dummy: string) {
		const verified = lxbase.verify_document();
		if (verified) {
			const tokens: number[] = await client.sendRequest(vsclnt.ExecuteCommandRequest.type,
				{
					command: 'merlin6502.tokenize',
					arguments: [
						verified.doc.getText().split(/\r?\n/),
						verified.doc.uri.toString()
					]
				});
			this.save_code(Buffer.from(Uint8Array.from(tokens)));
		}
		else
			vscode.window.showErrorMessage("could not find document tokenize");
	}
	async detokenize(tokens: Buffer) {
		const img_messg = Array.from(Uint8Array.from(tokens));
		const code = await client.sendRequest(vsclnt.ExecuteCommandRequest.type,
			{
				command: 'merlin6502.detokenize',
				arguments: img_messg
			});
		if (code)
			this.insert_code(code);
		else
			vscode.window.showErrorMessage("unable to detokenize source code");
	}
	async disassemble(fimg_str: string) {
		const fimg = new FileImage(fimg_str);
		const tool = new DisassemblyTool;
		const binaryFile = fimg.getBinary();
		if (!binaryFile) {
			vscode.window.showErrorMessage("could not interpret file image as binary "+fimg_str);
			return;
		}
		const [loadAddr, data] = binaryFile;
		const params = await tool.getDisassemblyParameters('Disassembly: Ranged', loadAddr, loadAddr, loadAddr + data.length);
		if (params)
			tool.insertCode(params, Buffer.from(data), undefined);
		else
			abortMessage();
	}
	async runOperation(typ: string) {
		if (this.operation == "get" && typ == "txt") {
			this.a2kit_txt2bin(["get", "-d", this.fsPath, "-f", this.imgPath[this.imgPath.length - 1], "-t", "mtok"], this.detokenize.bind(this), undefined);
		} else if (this.operation == "get" && typ == "bin") {
			this.a2kit_bin2txt(["get", "-d", this.fsPath, "-f", this.imgPath[this.imgPath.length - 1], "-t", "any"], this.disassemble.bind(this), undefined);
		} else if (this.operation == "put") {
			let existingFilesPrompt = "existing files: ";
			if (this.file_list.length == 0)
				existingFilesPrompt += "none";
			else
				existingFilesPrompt += this.file_list[0];
			for (let i = 1; i < this.file_list.length; i++) {
				existingFilesPrompt += ", " + this.file_list[i];
			}
			let fname = await vscode.window.showInputBox({ title: "enter filename", prompt: existingFilesPrompt });
			if (!fname)
				return;
			fname = fname.toUpperCase();
			this.imgPath.push(this.imgPath[this.imgPath.length - 1] + fname);
			if (this.file_list.includes(fname)) {
				const result = await vscode.window.showWarningMessage(fname + ' already exists', 'Overwrite', 'Cancel');
				if (result == 'Cancel') {
					abortMessage();
					return;
				}
				this.a2kit_bin2txt(["delete", "-d", this.fsPath, "-f", this.imgPath[this.imgPath.length - 1]], this.tokenize.bind(this), undefined);
				return;
			}
			this.tokenize("");
		} else {
			vscode.window.showErrorMessage("unknown disk image operation " + this.operation);
		}
	}
	async select(raw_catalog: string) {
		const catalog = this.parse_catalog(raw_catalog);
		if (!catalog) {
			vscode.window.showErrorMessage('could not parse disk catalog, raw data: '+raw_catalog);
			return;
		}
		const [dirs, files] = catalog;
		this.file_list = [];
		for (const file of files)
			this.file_list.push(file.substring(7));
		if (this.operation=="get" && dirs.length == 0 && files.length == 0 && this.imgPath.length == 1) {
			vscode.window.showErrorMessage('no text, binary, or directories were found, raw data: '+raw_catalog);
			return;
		}
		if (this.operation == "put" && dirs.length == 0 && this.imgPath.length == 1) {
			this.runOperation("txt");
			return;
		}
		const choices = Array<string>();
		if (this.operation == "put")
			choices.push("(DIR)  .");
		if (this.imgPath.length > 1)
			choices.push("(DIR)  ..");
		if (this.operation == "get")
			for (const file of files)
				choices.push(file);
		for (const dir of dirs)
			choices.push(dir);
		const title = this.operation == "get" ? 'select file' : 'select directory';
		const placeHolder = this.operation == "get" ? "" : " . selects, .. goes back up, ESC aborts";
		const fname = await vscode.window.showQuickPick(choices, { canPickMany: false, title, placeHolder });
		if (fname && fname == "(DIR)  ..") {
			this.imgPath.pop();
			this.recursiveSelection();
		} else if (fname && fname == "(DIR)  .") {
			this.runOperation("txt");
		} else if (fname && fname.substring(0, 7) == "(DIR)  ") {
			this.imgPath.push(this.imgPath[this.imgPath.length - 1] + fname.substring(7) + "/");
			this.recursiveSelection();
		} else if (fname && fname.substring(0, 7) == "(TXT)  ") {
			this.imgPath.push(this.imgPath[this.imgPath.length - 1] + fname.substring(7));
			this.runOperation("txt");
		} else if (fname && fname.substring(0, 7) == "(BIN)  ") {
			this.imgPath.push(this.imgPath[this.imgPath.length - 1] + fname.substring(7));
			this.runOperation("bin");
		} else if (fname && fname.substring(0, 7) == "(SYS)  ") {
			this.imgPath.push(this.imgPath[this.imgPath.length - 1] + fname.substring(7));
			this.runOperation("bin");
		} else if (!fname) {
			abortMessage();
		} else {
			vscode.window.showErrorMessage("unhandled selection " + fname);
		}
	}
	async recursiveSelection() {
		if (this.imgPath.length == 1)
			this.a2kit_bin2txt(["catalog", "-d", this.fsPath], this.select.bind(this), undefined);
		else
			this.a2kit_bin2txt(["catalog", "-d", this.fsPath, "-f", this.imgPath[this.imgPath.length-1]], this.select.bind(this), undefined);
	}
	async getFromImage() {
		const uri = await vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles": true,
			"filters": { "Disk image": ["2mg", "2img", "dsk", "do", "d13", "nib", "po", "woz"] },
			"title": "Insert from Disk Image"
		});
		if (!uri) {
			abortMessage();
			return;
		}
		this.operation = "get";
		this.fsPath = uri[0].fsPath;
		this.imgPath = [""];
		this.recursiveSelection();
	}
	async putToImage() {
		const uri = await vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles": true,
			"filters": { "Disk image": ["2mg", "2img", "dsk", "do", "d13", "nib", "po", "woz"] },
			"title": "Save to Disk Image"
		});
		if (!uri) {
			abortMessage();
			return;
		}
		this.operation = "put";
		this.fsPath = uri[0].fsPath;
		this.imgPath = [""];
		this.recursiveSelection();
	}
}

