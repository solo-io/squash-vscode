import * as vscode from 'vscode';

export class CloudPoints {
    decorationType: vscode.TextEditorDecorationType;
    breakpoints: Map<string, Set<number>>

    constructor(context: vscode.ExtensionContext) {
        this.breakpoints = new Map();
        let icon = context.asAbsolutePath("images/squash-breakpoint.svg");
        this.decorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: icon,
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            overviewRulerColor: "rgba(0, 203, 0, 0.7)"
        });


        vscode.window.onDidChangeActiveTextEditor(editor => {
            this.updateEditor();
        }, null, context.subscriptions);
    }

    updateEditor() {
        if (vscode.window.activeTextEditor) {
            this.updateUI();
        }
    }

    toggle() {

        if (!vscode.window.activeTextEditor) {
            vscode.window.showInformationMessage("Open a file first to toggle bookmarks");
            return;
        }

        let line = vscode.window.activeTextEditor.selection.active.line;
        this.toggle_bp(line)
        this.updateUI()

    }

    get_sorted_bp(): number[] {
        let arr: number[] = Array.from(this.breakpoints.get(this.get_current_file()));
        arr.sort();
        return arr
    }


    get_all_locations(): string[] {
        let ret : string[] = [];

        this.breakpoints.forEach((value, key) => {
            value.forEach((line) => {
                let lineno = line + 1;
                ret.push(key +":"+lineno);
            });
        });
        return ret;
    }

    toggle_bp(line: number) {
        let f = this.get_current_file();
        if (! this.breakpoints.has(f)) {
            this.breakpoints.set(f, new Set<number>());
        }

        let numbers: Set<number> = this.breakpoints.get(f);
        if (numbers.has(line)) {
            numbers.delete(line);
        } else {
            numbers.add(line)
        }
    }

    get_current_file(): string {
        let path = vscode.window.activeTextEditor.document.uri.fsPath;
        path = path.replace("///", "/");
        path = path.replace(vscode.workspace.rootPath, "");
        if (path.startsWith("/")) {
            path = path.substr(1);
        }
        return path;
    }

    updateUI() {
        let activeEditor = vscode.window.activeTextEditor;

        let bps: vscode.Range[] = [];
        for (let line of this.get_sorted_bp()) {
            // let element = bookmarks.activeBookmark.bookmarks[index];

            if (line <= activeEditor.document.lineCount) {
                let decoration = new vscode.Range(line, 0, line, 0);
                bps.push(decoration);
            }
        }
        activeEditor.setDecorations(this.decorationType, bps);

    }
}

