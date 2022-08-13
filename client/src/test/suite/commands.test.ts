import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';

async function testFormat(progName: string, expectedCode: string) {
	while (vscode.window.activeTextEditor)
		await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	const progPath = path.resolve(__dirname, '..', '..', '..', '..', 'sample', 'test', progName);
	const doc = await vscode.workspace.openTextDocument(progPath);
	const ed = await vscode.window.showTextDocument(doc);
	if (!ed)
		assert.fail('no active text editor');
	let collections: [vscode.Uri,vscode.Diagnostic[]][];
	do {
		collections = vscode.languages.getDiagnostics();
	} while (!collections);
	const actualCode = await vscode.commands.executeCommand("merlin6502.format");
	assert.strictEqual(actualCode,expectedCode);
}

describe('Commands: format', function() {
	it('straight code', async function() {
		const expectedCode = ' LDA #$00\n BEQ 10\n';
		await testFormat('test-fmt-straight.S', expectedCode);
	});
	it('comments', async function() {
        const expectedCode = '** spaces     spaces **\n LDA #$00\n BEQ 10 ;   spaces\n** tabs **\n LDA #$00\n';
		await testFormat('test-fmt-comments.S', expectedCode);
	});
	it('strings', async function() {
        const expectedCode = ' LDA #$00\n ASC "spaces   spaces"\n';
		await testFormat('test-fmt-strings.S', expectedCode);
	});
});

