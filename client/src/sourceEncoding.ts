import * as vscode from 'vscode';
import * as lxbase from './langExtBase';

export async function insert_from_ram_image(img: Buffer, auxZP: Buffer | undefined)
{
    const begAddr = auxZP ? auxZP[10] + 256*auxZP[11] : img[10] + 256*img[11];
    const endAddr = auxZP ? auxZP[14] + 256*auxZP[15] : img[14] + 256*img[15];
    const img_messg: number[] = Array.from(Uint8Array.from(img));
    try {
        const content = await lxbase.request<string>('merlin6502.detokenize', [img_messg.slice(begAddr, endAddr)]);
        const verified = lxbase.verify_document();
        if (verified && content && content.length > 1)
            verified.ed.edit(edit => { edit.replace(verified.ed.selection, content); });
        else if (verified)
            vscode.window.showWarningMessage('insert failed (no code found)');
        else
            vscode.window.showWarningMessage('insert failed (problem with document)');
    } catch (error) {
		if (error instanceof Error)
			vscode.window.showErrorMessage(error.message);
    }
}

export async function insert_from_file_data(img: number[])
{
    try {
        const content = await lxbase.request<string>('merlin6502.detokenize', [img]);
        const verified = lxbase.verify_document();
        if (verified && content && content.length > 1)
            verified.ed.edit(edit => { edit.replace(verified.ed.selection, content); });
        else if (verified)
            vscode.window.showWarningMessage('insert failed (no code found)');
        else
            vscode.window.showWarningMessage('insert failed (problem with document)');
    } catch (error) {
		if (error instanceof Error)
			vscode.window.showErrorMessage(error.message);
    }
}
