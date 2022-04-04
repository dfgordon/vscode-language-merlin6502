import * as vscode from 'vscode';
import * as lxbase from '../../langExtBase';
import * as com from '../../commands';
import * as assert from 'assert';

describe('suite placeholder 1', async function() {
	//vscode.window.showInformationMessage('Start output statements');
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
	});
	it('case placeholder 1', function() {
		const actual = "050A004B01";
		const expected = "050A004B01";
		assert.deepStrictEqual(actual,expected);
	});
});
