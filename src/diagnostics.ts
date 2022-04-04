import * as vscode from 'vscode';
import Parser from 'web-tree-sitter';
import * as lxbase from './langExtBase';

// Apparently no standard provider, so make one up
export class TSDiagnosticProvider extends lxbase.LangExtBase
{
	node_to_range(node: Parser.SyntaxNode): vscode.Range
	{
		const start_pos = new vscode.Position(node.startPosition.row,node.startPosition.column);
		const end_pos = new vscode.Position(node.endPosition.row,node.endPosition.column);
		return new vscode.Range(start_pos,end_pos);
	}
	value_range(diag: Array<vscode.Diagnostic>,node: Parser.SyntaxNode,low:number,high:number)
	{
		if (node.type!="integer")
			return;
		const rng = this.node_to_range(node);
		const parsed = parseInt(node.text);
		if (!isNaN(parsed))
			if (parsed<low || parsed>high)
				diag.push(new vscode.Diagnostic(rng,'Out of range ('+low+','+high+')'));
	}
	is_error_inside(node: Parser.SyntaxNode): boolean
	{
		let child = node.firstChild;
		if (child)
		{
			do
			{
				if (child.hasError())
					return true;
				child = child.nextNamedSibling;
			} while (child);
		}
		return false;
	}
	process_node(diag: Array<vscode.Diagnostic>,curs: Parser.TreeCursor): boolean
	{
		const rng = this.curs_to_range(curs);
		if (curs.currentNode().hasError())
		{
			if (!this.is_error_inside(curs.currentNode()))
				diag.push(new vscode.Diagnostic(rng,curs.currentNode().toString(),vscode.DiagnosticSeverity.Error));
		}
		if (curs.currentNode().type=="filename")
		{
			const child = curs.currentNode().firstChild;
			if (child && child.type=="dos33")
				diag.push(new vscode.Diagnostic(rng,'name is valid for DOS 3.3, but not ProDOS',vscode.DiagnosticSeverity.Warning));
		}
		return true;
	}
	update(document : vscode.TextDocument, collection: vscode.DiagnosticCollection): void
	{
		if (document && document.languageId=='merlin6502')
		{
			const diag = Array<vscode.Diagnostic>();
			const syntaxTree = this.parse(document.getText(),"\n");
			const cursor = syntaxTree.walk();
			let recurse = true;
			let finished = false;
			do
			{
				if (recurse && cursor.gotoFirstChild())
					recurse = this.process_node(diag,cursor);
				else
				{
					if (cursor.gotoNextSibling())
						recurse = this.process_node(diag,cursor);
					else if (cursor.gotoParent())
						recurse = false;
					else
						finished = true;
				}
			} while (!finished);
			collection.set(document.uri, diag);
		}
		else
		{
			collection.clear();
		}
	}
}