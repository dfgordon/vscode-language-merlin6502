import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';

async function diagnosticTester(progName: string, expectedMessages: RegExp[]) {
	while (vscode.window.activeTextEditor)
		await vscode.commands.executeCommand("workbench.action.closeActiveEditor", vscode.window.activeTextEditor.document.uri);
	const progPath = path.resolve(__dirname, '..', '..', '..', '..', 'sample', 'test', progName);
	const doc = await vscode.workspace.openTextDocument(progPath);
	const ed = await vscode.window.showTextDocument(doc);
	vscode.languages.setTextDocumentLanguage(doc, 'merlin6502');
	if (!ed)
		assert.fail('no active text editor');
	let tries = 0;
	let diagList: vscode.Diagnostic[] | undefined;
	while (!diagList && tries<20) {
		const collections = vscode.languages.getDiagnostics();
		for (const pair of collections) {
			if (pair[0].toString() == doc.uri.toString())
				diagList = pair[1];
		}
		await new Promise(resolve => setTimeout(resolve, 200));
		tries += 1;
	}
	if (diagList) {
		assert.strictEqual(diagList.length, expectedMessages.length);
		for (let i = 0; i < diagList.length; i++)
			assert.match(diagList[i].message, expectedMessages[i]);
	} else {
		if (expectedMessages.length > 0)
			assert.fail('could net retrieve diagnostics');
	}
}

describe('Diagnostics: Processors', function () {
	it('65c02 disabled', async function () {
		this.timeout(8000); // first one may take a while
		const v = vscode.workspace.getConfiguration('merlin6502')?.get('version');
		if (v && v == 'Merlin 8')
			await diagnosticTester('test-65c02-disabled.S', [
				/macro is undefined/,
				/macro is undefined/,
				/macro name matches a disabled instruction/,
				/macro name matches a disabled instruction/,
			]);
		else if (v)
			await diagnosticTester('test-65c02-disabled.S', []);
		else
			assert.fail('could not get configuration');
	});
	it('65816 disabled', async function () {
		const v = vscode.workspace.getConfiguration('merlin6502')?.get('version');
		if (v && v == 'Merlin 8')
			await diagnosticTester('test-65816-disabled.S', [
				/addressing mode disabled/
			]);
		else if (v)
			await diagnosticTester('test-65816-disabled.S', [
				/XC count/
			]);
		else
			assert.fail('could not get configuration');
	});
});

describe('Diagnostics: Macros', function () {
	it('matches instruction', async function () {
		await diagnosticTester('test-matches-instruction.S', [
			/macro name matches a mnemonic/,
			/macro name matches a mnemonic/,
			/folding range is never closed/,
			/folding range is never closed/,
			/macro is never referenced/,
			/macro is never referenced/,
		]);
	});
	it('undefined macro', async function () {
		await diagnosticTester('test-mac-undefined.S', [
			/macro is undefined/,
			/macro is undefined/,
			/macro is undefined/
		]);
	});
	it('forward macro', async function () {
		await diagnosticTester('test-mac-forward.S', [
			/macro is forward referenced/
		]);
	});
	it('macro context', async function () {
		await diagnosticTester('test-mac-context.S', [
			/macro is never referenced/,
			/macro cannot be used here/
		]);
	});
	it('macro termination', async function () {
		await diagnosticTester('test-mac-termination.S', [
			/unmatched end of macro/,
			/macro is never referenced/,
		]);
	});
	it('pseudo ops in macro', async function () {
		await diagnosticTester('test-mac-psops.S', [
			/macro is never referenced/,
			/pseudo operation cannot be used/,
			/pseudo operation cannot be used/,
			/pseudo operation cannot be used/
		]);
	});
	it('macro variables', async function () {
		const v = vscode.workspace.getConfiguration('merlin6502')?.get('version');
		if (v && v == 'Merlin 8') {
			await diagnosticTester('test-mac-vars.S', [
				/macro substitution variable cannot label a line/,
				/macro substitution variable cannot label a line/,
				/extension cannot evaluate, assuming true/,
				/label is never referenced/, // actually it is, but with differnt meaning
				/macro substitution variable referenced outside macro/,
				/macro is never referenced/,
				/macro substitution variable referenced outside macro/,
				/macro substitution variable referenced outside macro/
			]);
		} else if (v) {
			await diagnosticTester('test-mac-vars.S', [
				/macro substitution variable cannot label a line/,
				/macro substitution variable cannot label a line/,
				/argument count cannot label a line/,
				/extension cannot evaluate, assuming true/,
				/label is never referenced/, // actually it is, but with differnt meaning
				/macro substitution variable referenced outside macro/,
				/macro is never referenced/,
				/macro substitution variable referenced outside macro/,
				/argument count referenced outside macro/,
				/macro substitution variable referenced outside macro/
			]);
		} else {
			assert.fail('could not get configuration');
		}
	});
	it('macro args', async function () {
		await diagnosticTester('test-mac-args.S', [
			/assembly disabled by ELSE/,
			/argument missing: `]3`/,
			/argument not used/,
			/conditionally missing argument: `]2`/,
			/argument not used/,
			/uninterpreted literal/
		]);
	});
});

describe('Diagnostics: declarations', function () {
	it('undefined global', async function () {
		await diagnosticTester('test-decs-un-glob.S', [
			/global label is undefined/
		]);
	});
	it('undefined local', async function () {
		await diagnosticTester('test-decs-un-loc.S', [
			/label is never referenced/,
			/local label is not defined in this scope/
		]);
	});
	it('forward variable', async function () {
		await diagnosticTester('test-decs-fwd-var.S', [
			/macro substitution variable cannot label a line/,
			/label is never referenced/,
			/label is never referenced/,
			/variable is forward referenced/,
			/label is never referenced/,
		]);
	});
	it('redefinitions', async function () {
		await diagnosticTester('test-decs-redefined.S', [
			/redefinition of a global label/,
			/redefinition of a local label/,
			/label is never referenced/,
			/label is never referenced/,
		]);
	});
});

describe('Diagnostics: locals', function () {
	it('no scope', async function () {
		await diagnosticTester('test-loc-noscope.S', [
			/no global scope is defined yet/,
			/label is never referenced/,
		]);
	});
	it('forbidden pseudo-op', async function () {
		await diagnosticTester('test-loc-psops.S', [
			/label is never referenced/,
			/label is never referenced/,
			/cannot use local label for EQU/,
			/cannot use local label for ENT/,
			/label is never referenced/,
			/cannot use local label for EXT/,
		]);
	});
	it('local in macro', async function () {
		await diagnosticTester('test-loc-macro.S', [
			/label is never referenced/,
			/macro is never referenced/,
			/cannot use local labels in a macro/,
		]);
	});
});

describe('Diagnostics: equates', function () {
	it('external equates', async function () {
		const v = vscode.workspace.getConfiguration('merlin6502')?.get('version');
		if (v && v == 'Merlin 8')
			await diagnosticTester('test-ext-equates.S', [
				/pseudo-op argument is disabled/,
				/pseudo-op argument is disabled/,
				/pseudo-op argument is disabled/
			]);
		else if (v)
			await diagnosticTester('test-ext-equates.S', [
			]);
		else
			assert.fail('could not get configuration');
	});
	it('undefined entry equates', async function () {
		const v = vscode.workspace.getConfiguration('merlin6502')?.get('version');
		if (v && v == 'Merlin 8')
			await diagnosticTester('test-ent-equates.S', [
				/entry label declared, but never defined/,
				/pseudo-op argument is disabled/,
				/pseudo-op argument is disabled/,
				/pseudo-op argument is disabled/,
			]);
		else if (v)
			await diagnosticTester('test-ent-equates.S', [
				/entry label declared, but never defined/
			]);
		else
			assert.fail('could not get configuration');
	});
});

describe('Diagnostics: forward', function () {
	it('psop_fwd', async function () {
			await diagnosticTester('test-ill-fwd.S', [
				/evaluation was deferred/,
				/illegal forward reference/,
				/forward reference check deferred/
			]);
	});
});