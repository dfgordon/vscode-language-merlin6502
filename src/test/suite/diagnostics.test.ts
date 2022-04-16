import * as vscode from 'vscode';
import * as lxbase from '../../langExtBase';
import * as diagnostics from '../../diagnostics';
import * as assert from 'assert';

describe('Diagnostics: Processors', async function() {
	//vscode.window.showInformationMessage('Start output statements');
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.prov = new diagnostics.TSDiagnosticProvider(TSInitResult);
	});
	it('65c02 disabled', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' LDA #$00\n BRA 10',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,2);
			assert.match(diagList[0].message,/macro is undefined.*/);
			assert.match(diagList[1].message,/macro name matches a disabled instruction.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('65816 disabled', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' XC\n LDA #$00\n BRA 10\n LDA [0]\n',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/addressing mode disabled.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
});

describe('Diagnostics: Macros', async function() {
	//vscode.window.showInformationMessage('Start output statements');
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.prov = new diagnostics.TSDiagnosticProvider(TSInitResult);
	});
	it('undefined macro', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' mymac1 00;01\n PMC mac2\n >>> mac3,00',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,3);
			assert.match(diagList[0].message,/macro is undefined.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('forward macro', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' mymac1 00;01\nmymac1 MAC\n INX\n EOM',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/macro is forward referenced.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('possibly undefined', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' USE myfile\n mymac1 00;01\n PMC mac2\n >>> mac3,00',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,3);
			assert.match(diagList[0].message,/macro might be undefined.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('possibly forward', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' USE myfile\n mymac1 00;01\nmymac1 MAC\n INX\n EOM',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/macro might be forward referenced.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('macro context', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'MYMAC MAC\n LDA #$00\n EOM\n LDA MYMAC',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/macro cannot be used here.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('macro termination', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'mac1 MAC\n LDA #$00\n <<<\n <<<',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/unmatched.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
});

describe('Diagnostics: declarations', async function() {
	//vscode.window.showInformationMessage('Start output statements');
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.prov = new diagnostics.TSDiagnosticProvider(TSInitResult);
	});
	it('undefined global', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'G1 EQU $00\n LDA G1\n LDA G2\n LDA G3\nG3 EQU $01',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/global label is undefined.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('possibly undefined', async function() {
		const doc = await vscode.workspace.openTextDocument({content:' PUT FILE\nG1 EQU $00\n LDA G1\n LDA G2\n LDA G3\nG3 EQU $01',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/global label might be undefined.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('undefined local', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'SCOPE\n:loc1 LDA #$01\n BNE :loc1\n BEQ :loc2',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/local label is not defined.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('forward variable', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'SCOPE\n:loc1 LDA ]var1\n]var1 EQU $00',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/forward reference.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('redefinitions', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'SCOPE\nSCOPE EQU $00\n:loc LDA SCOPE\n:loc LDX $00',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,2);
			assert.match(diagList[0].message,/redefinition.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
});

describe('Diagnostics: locals', async function() {
	//vscode.window.showInformationMessage('Start output statements');
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.prov = new diagnostics.TSDiagnosticProvider(TSInitResult);
	});
	it('no scope', async function() {
		const doc = await vscode.workspace.openTextDocument({content:':G1 EQU $00',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/no global scope.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('forbidden pseudo-op', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'SCOPE\n:loc1 MAC\n:loc2 EQU $00\n:loc3 ENT\n:loc4 EXT',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,4);
			assert.match(diagList[0].message,/cannot use local.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
	it('forbidden in macro', async function() {
		const doc = await vscode.workspace.openTextDocument({content:'SCOPE\nmymac MAC\n:loc1 LDA #$00\n EOM',language:'merlin6502'});
		const ed = await vscode.window.showTextDocument(doc);
		if (!ed)
			assert.fail('no active text editor');
		const collections = vscode.languages.getDiagnostics();
		for (const collection of collections)
		{
			if (collection[0]!=doc.uri)
				continue;
			const diagList = collection[1];
			assert.strictEqual(diagList.length,1);
			assert.match(diagList[0].message,/cannot use local.*/);
		}
		while (vscode.window.activeTextEditor)
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	});
});
