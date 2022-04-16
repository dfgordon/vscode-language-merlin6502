import * as vscode from 'vscode';
import * as lxbase from '../../langExtBase';
import * as com from '../../commands';
import * as assert from 'assert';

describe('Commands: format', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult);
	});
	it('straight code', async function() {
        const testCode = '   LDA \t #$00\n\tBEQ\t10';
        const expectedCode = ' LDA #$00\n BEQ 10\n';
		const doc = await vscode.workspace.openTextDocument({content:testCode,language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
        await this.disTool.showPasteableProgram();
        assert.strictEqual(this.disTool.formattedCode,expectedCode);
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('comments with spaces', async function() {
        const testCode = '** spaces     spaces **\n   LDA \t #$00\n\tBEQ\t10\t;   spaces';
        const expectedCode = '** spaces     spaces **\n LDA #$00\n BEQ 10 ;   spaces\n';
		const doc = await vscode.workspace.openTextDocument({content:testCode,language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
        await this.disTool.showPasteableProgram();
        assert.strictEqual(this.disTool.formattedCode,expectedCode);
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('strings with spaces', async function() {
        const testCode = '   LDA \t #$00\n\tASC\t"spaces   spaces"';
        const expectedCode = ' LDA #$00\n ASC "spaces   spaces"\n';
		const doc = await vscode.workspace.openTextDocument({content:testCode,language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
        await this.disTool.showPasteableProgram();
        assert.strictEqual(this.disTool.formattedCode,expectedCode);
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('comments with tabs', async function() {
        const testCode = '*\t\t*\n   LDA \t #$00';
        const expectedCode = '* *\n LDA #$00\n'; // tab runs in comments are also reduced to a space
		const doc = await vscode.workspace.openTextDocument({content:testCode,language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
        await this.disTool.showPasteableProgram();
        assert.strictEqual(this.disTool.formattedCode,expectedCode);
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
});

