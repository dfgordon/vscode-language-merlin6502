import * as vscode from 'vscode';
import * as lxbase from './langExtBase';
import * as srcEncoding from './sourceEncoding';
import * as dasm from './disassembly';

const FNAME_START = 12;
const ABORT_MESS = "disk image operation aborted by user";

/**
 * This object sends requests to the server for disk image data.
 * The a2kit library is now bundled with the server, so there is no
 * need to run the a2kit CLI in a subprocess anymore.
 */
export class A2KitTool extends lxbase.LangExtBase {
	operation = "get";
	resultString = "";
	resultBytes: Buffer = Buffer.from("");
	imgPath = [""]; // path for each depth traversed, volume prefix is assumed
	fsType = "";
	file_list: string[] = [];
	currPath(): string {
		return this.imgPath[this.imgPath.length - 1];
	}
	getExisting(lst: string[]): string[] {
		const ans = new Array<string>()
		for (const s of lst) {
			ans.push(s.substring(FNAME_START));
		}
		return ans;
	}
	/** update this.imgPath based on the user selection.
	 * return value is true if we need to keep selecting, false otherwise.
	 * throws an error if user aborts or there is an unexpected selection. */
	async select(rows: Array<string>): Promise<boolean> {
		if (this.operation == "put" && rows.length == 0 && this.imgPath.length == 1) {
			this.fsType = "DIR";
			return false;
		}
		const dotRow = "DIR" + " ".repeat(9) + ".";
		const dotDotRow = "DIR" + " ".repeat(9) + "..";
		const choices = Array<string>();
		if (this.operation == "put")
			choices.push(dotRow);
		if (this.imgPath.length > 1)
			choices.push(dotDotRow);
		for (const row of rows)
			if (row.startsWith("DIR"))
				choices.push(row);
		for (const row of rows)
			if (!row.startsWith("DIR"))
				choices.push(row);
		const fname = await vscode.window.showQuickPick(choices, { canPickMany: false, title: this.operation == "get" ? 'select file' : 'select directory' });
		if (fname && fname == dotDotRow) {
			this.imgPath.pop();
			return true;
		} else if (fname && fname == dotRow) {
			this.fsType = "DIR";
			return false
		} else if (fname && fname.startsWith("DIR")) {
			this.imgPath.push(this.currPath() + fname.substring(FNAME_START) + "/");
			return true;
		} else if (fname && fname.startsWith("TXT")) {
			this.imgPath.push(this.currPath() + fname.substring(FNAME_START));
			this.fsType = "TXT";
			return false;
		} else if (fname && fname.startsWith("BIN")) {
			this.imgPath.push(this.currPath() + fname.substring(FNAME_START));
			this.fsType = "BIN";
			return false;
		} else if (fname && fname.startsWith("SYS")) {
			this.imgPath.push(this.currPath() + fname.substring(FNAME_START));
			this.fsType = "SYS";
			return false;
		} else if (!fname) {
			throw new Error("aborted");
		} else {
			throw new Error("unhandled selection");
		}
	}
	async getFromImage() {
		const uri = await vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles": true,
			"filters": { "Disk image": ["2mg", "2img", "dsk", "do", "d13", "nib", "po", "woz"] },
			"title": "Insert from Disk Image"
		});
		if (!uri) {
			vscode.window.showInformationMessage(ABORT_MESS);
			return;
		}
		try {
			await lxbase.request<null>("merlin6502.disk.mount", [uri[0].fsPath]);
	
			this.operation = "get";
			this.imgPath = [""];
			
			let response: string[] | number[] | string = await lxbase.request<Array<string>>("merlin6502.disk.pick", [this.currPath(),["txt","bin","sys"]]);
			if (response.length==0) {
				vscode.window.showErrorMessage('no sources, binaries, or directories were found');
				return;
			}
	
			let selecting;
			do {
				selecting = await this.select(response);
				if (selecting) {
					response = await lxbase.request<Array<string>>("merlin6502.disk.pick", [this.currPath(), ["txt", "bin", "sys"]]);
				}
			} while (selecting);
			response = await lxbase.request<Array<number>>("merlin6502.disk.pick", [this.currPath(), ["txt", "bin", "sys"]]);
			if (this.fsType == "TXT") {
				// first two bytes are reserved for load address
				srcEncoding.insert_from_file_data(response.slice(2, undefined));
			} else {
				const load_addr = response[0] + 256 * response[1];
				const img = new Array<number>(load_addr);
				img.push(...response.slice(2, undefined));
				const disassembler = new dasm.DisassemblyTool();
				const params = await disassembler.getDisassemblyParameters(dasm.DasmRange.All, 0, 2 ** 16);
				if (params) {
					params.rng_type = dasm.DasmRange.Range;
					params.addrRange[0] = load_addr;
					params.addrRange[1] = load_addr + response.length - 2;
					disassembler.insertCode(params, Buffer.from(img));
				} else {
					vscode.window.showInformationMessage(ABORT_MESS);
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.message == "aborted")
					vscode.window.showInformationMessage(ABORT_MESS);
				else
					vscode.window.showErrorMessage(error.message);
			}
		}
	}
	async putToImage() {
		const uri = await vscode.window.showOpenDialog({
			"canSelectMany": false,
			"canSelectFiles": true,
			"filters": { "Disk image": ["2mg", "2img", "dsk", "do", "d13", "nib", "po", "woz"] },
			"title": "Save to Disk Image"
		});
		if (!uri) {
			vscode.window.showInformationMessage(ABORT_MESS);
			return;
		}

		try {
			await lxbase.request<null>("merlin6502.disk.mount", [uri[0].fsPath]);
	
			this.operation = "put";
			this.imgPath = [""];
			
			// pick the directory
			let response = await lxbase.request<string[]>("merlin6502.disk.pick", [this.currPath(),[]]);
			let selecting;
			do {
				selecting = await this.select(response);
				response = await lxbase.request<string[]>("merlin6502.disk.pick", [this.currPath(),[]]);
			} while (selecting);

			// get files in this directory for user's information and for overwrite check
			response = await lxbase.request<string[]>("merlin6502.disk.pick", [this.currPath(), null]);
			const existingFileList = this.getExisting(response);
			let existingFilesPrompt = "existing files: ";
			if (existingFileList.length == 0)
				existingFilesPrompt += "none";
			else
				existingFilesPrompt += existingFileList[0];
			for (let i = 1; i < existingFileList.length; i++) {
				existingFilesPrompt += ", " + existingFileList[i];
			}

			// choose name for file to save and save/overwrite
			let fname = await vscode.window.showInputBox({ title: "enter filename", prompt: existingFilesPrompt });
			if (!fname) {
				vscode.window.showInformationMessage(ABORT_MESS);
				return;
			}
			fname = fname.toUpperCase();
			this.imgPath.push(this.currPath() + fname);
			if (existingFileList.includes(fname)) {
				const result = await vscode.window.showWarningMessage(fname + ' already exists', 'Overwrite', 'Cancel');
				if (result == 'Cancel') {
					vscode.window.showInformationMessage(ABORT_MESS);
					return;
				}
				await lxbase.request<null>("merlin6502.disk.delete", [this.currPath()]);
			}
			const verified = lxbase.verify_document();
			if (!verified) {
				vscode.window.showErrorMessage("document not found");
				return;
			}
			await lxbase.request<null>("merlin6502.disk.put", [this.currPath(), verified.doc.getText(), verified.doc.uri.toString()]);
			vscode.window.showInformationMessage(this.currPath()+" saved to disk image");
		} catch (error) {
			if (error instanceof Error) {
				if (error.message == "aborted")
					vscode.window.showInformationMessage(ABORT_MESS);
				else
					vscode.window.showErrorMessage(error.message);
			}
		}
	}
}
