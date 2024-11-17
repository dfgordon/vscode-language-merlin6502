import * as vscode from 'vscode';
import * as lxbase from './langExtBase';

export enum DasmRange {
    All = "all",
    LastBloadDos33 = "last dos33 bload",
    LastBloadProdos = "last prodos bload",
    Range = "range"
}

enum LabelPolicy {
    None = "none",
    Some = "some",
    All = "all"
}

export type DasmParams = {
	rng_type: string,
	addrRange: [number, number],
	xc: number,
	mx: number,
	label: string
}

export class DisassemblyTool
{
	async getAddressInput(name: string,min:number,max:number,suggestion:number) : Promise<number | undefined>
	{
		const res = await vscode.window.showInputBox({
			title: 'enter ' + name + ' address',
			value: suggestion.toString(),
			validateInput: (value) => {
				const val = parseInt(value);
				if (isNaN(val))
					return "address should be a number"
				if (val < min || val > max)
					return "range is " + min + " to " + max;
				return undefined;
			}
		});
		if (!res)
			return undefined;
		return parseInt(res);
	}
	async getDisassemblyParameters(rng_type: DasmRange, minAddr: number, maxAddr: number): Promise<DasmParams | undefined> {
		let xc = 0;
		let mx = 3;
		let label = LabelPolicy.Some;

		let startAddr: number | undefined = 0;
		let endAddr: number | undefined = 0;

		// range
		if (rng_type == DasmRange.Range)
			startAddr = await this.getAddressInput('starting', minAddr, maxAddr - 1, minAddr);
		if (startAddr == undefined)
			return;
		if (rng_type == DasmRange.Range)
			endAddr = await this.getAddressInput('ending', startAddr + 1, maxAddr, maxAddr);
		if (endAddr == undefined)
			return;
        
		// processor type
		const res = await vscode.window.showQuickPick([
			'6502',
			'65C02',
			'65816 MX=00',
			'65816 MX=01',
			'65816 MX=10',
			'65816 MX=11'], { title: 'Processor Target' });
		if (!res) {
			return;
		} else if (res == '6502') {
			xc = 0;
			mx = 3;
		} else if (res == '65C02') {
			xc = 1;
			mx = 3;
		} else if (res == '65816 MX=00') {
			xc = 2;
			mx = 0;
		} else if (res == '65816 MX=01') {
			xc = 2;
			mx = 1;
		} else if (res == '65816 MX=10') {
			xc = 2;
			mx = 2;
		} else if (res == '65816 MX=11') {
			xc = 2;
			mx = 3;
		}
        
        // label policy
		const lbl = await vscode.window.showQuickPick(['label every line','label some lines','label no lines'],{title:'Label Policy'});
		if (!lbl)
            return;
        if (lbl.includes("every")) {
            label = LabelPolicy.All;
        } else if (lbl.includes("some")) {
            label = LabelPolicy.Some;
        } else {
            label = LabelPolicy.None;
        }

        return {
            addrRange: [startAddr,endAddr],
            rng_type,
			xc,
			mx,
            label
        };
	}
	async insertCode(params:DasmParams,img:Buffer)
	{
		let content = '';
        const img_messg: number[] = Array.from(Uint8Array.from(img));
        content = await lxbase.request<string>('merlin6502.disassemble', [
            img_messg,
            params.addrRange[0],
            params.addrRange[1],
            params.rng_type,
			params.xc,
			params.mx,
            params.label
        ]);
		const verified = lxbase.verify_document();
		if (verified && content && content.length>1)
			verified.ed.edit( edit => { edit.replace(verified.ed.selection,content); });
		else if (verified)
			vscode.window.showWarningMessage('insert failed (no code found)');
		else
			vscode.window.showWarningMessage('insert failed (problem with document)');
	}
}

async function convert(cmd: string) {
	let verified = lxbase.verify_document();
	if (!verified)
		return;
	const proceed = await lxbase.proceedDespiteErrors(verified.doc,'Spot Assembly',undefined);
	if (!proceed)
		return;
	verified = lxbase.verify_document();
	if (!verified)
		return;
	const [beg, end] = lxbase.selectionToLineRange(verified.ed.selection);
	try {
		const content = await lxbase.request<string>(cmd, [
			verified.doc.getText(),
			verified.doc.uri.toString(),
			beg,
			end
		]);
		if (verified && content && content.length>1)
			verified.ed.edit(edit => {
				if (verified)
					edit.replace(verified.ed.selection, content);
			});
		else if (verified)
			vscode.window.showWarningMessage('insert failed (no code found)');
		else
			vscode.window.showWarningMessage('insert failed (problem with document)');
	} catch (error) {
		if (error instanceof Error)
			vscode.window.showErrorMessage(error.message);
	}
}

export async function toData() {
	convert('merlin6502.toData');
}

export async function toCode() {
	convert('merlin6502.toCode');
}
