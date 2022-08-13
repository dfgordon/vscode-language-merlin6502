import * as vscode from 'vscode';

export function verify_document() : {ed:vscode.TextEditor,doc:vscode.TextDocument} | undefined
{
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor)
		return undefined;
	const document = textEditor.document;
	if (!document || document.languageId!='merlin6502')
		return undefined;
	return {ed:textEditor,doc:document};
}
