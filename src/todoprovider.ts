import * as vscode from 'vscode';

// 1. Simple, reliable check for whether a file contains a "todo:" comment
const FILE_HAS_TODO_REGEX = /(?:#|\/\/|\/\*|<!--|\*)\s*\\*todo:/i;

// 2. Strict single-line parser for extracting content and <flags>
const LINE_TODO_REGEX = /(?:#|\/\/|\/\*|<!--|\*)\s*\\*todo:\s*(.*)/i;

// Interface for user flag settings from package.json / settings.json
interface FlagConfig {
    icon?: string;
    color?: string;
    description?: string;
}

export class TodoTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string | vscode.TreeItemLabel,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: 'file' | 'todo',
        public readonly resourceUri?: vscode.Uri,
        public readonly line?: number,
        public readonly activeFlags: string[] = []
    ) {
        super(label, collapsibleState);

        if (contextValue === 'todo' && resourceUri && line !== undefined) {
            const textLabel = typeof label === 'string' ? label : label.label;

            // Fetch user configured flags from settings: commentView.flags
            const flagSettings = vscode.workspace
                .getConfiguration('commentView')
                .get<Record<string, FlagConfig>>('flags', {});

            let appliedIcon = 'bookmark';
            let appliedColor: string | undefined;
            const extraDescriptions: string[] = [];

            // Check active flags against workspace setting configs
            for (const flag of activeFlags) {
                const config = flagSettings[flag];
                if (config) {
                    if (config.icon) appliedIcon = config.icon;
                    if (config.color) appliedColor = config.color;
                    if (config.description) extraDescriptions.push(config.description);
                }
            }

            // Build item description and tooltip based on matched flag tags
            const descPrefix =
                extraDescriptions.length > 0 ? `[${extraDescriptions.join(', ')}] ` : '';
            this.description = `${descPrefix}Line ${line + 1}`;
            this.tooltip = `${textLabel} ${descPrefix}(Line ${line + 1})`;

            // Apply ThemeIcon and optional ThemeColor
            if (appliedColor) {
                this.iconPath = new vscode.ThemeIcon(
                    appliedIcon,
                    new vscode.ThemeColor(appliedColor)
                );
            } else {
                this.iconPath = new vscode.ThemeIcon(appliedIcon);
            }

            // Jump to line when clicked
            this.command = {
                command: 'vscode.open',
                title: 'Open TODO',
                arguments: [
                    this.resourceUri,
                    {
                        selection: new vscode.Range(line, 0, line, 0)
                    }
                ]
            };
        } else if (contextValue === 'file' && resourceUri) {
            this.resourceUri = resourceUri;
        }
    }

    // Helper check to determine if this item includes the 'done' flag
    public get isDone(): boolean {
        return this.activeFlags.includes('done');
    }
}

export class TodoTreeDataProvider implements vscode.TreeDataProvider<TodoTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TodoTreeItem | undefined | null | void> =
        new vscode.EventEmitter<TodoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TodoTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TodoTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Toggles the <done> flag on the targeted TODO line
     */
    public async toggleTodoStatus(item: TodoTreeItem): Promise<void> {
        if (!item.resourceUri || item.line === undefined) {
            return;
        }

        const document = await vscode.workspace.openTextDocument(item.resourceUri);
        const lineText = document.lineAt(item.line).text;

        let updatedText: string;

        if (item.isDone) {
            // Remove <done> flag if present
            updatedText = lineText.replace(/\s*<done>/i, '');
        } else {
            // Append <done> flag to line end
            updatedText = `${lineText} <done>`;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            item.resourceUri,
            new vscode.Range(item.line, 0, item.line, lineText.length),
            updatedText
        );

        await vscode.workspace.applyEdit(edit);
        await document.save();
    }

    async getChildren(element?: TodoTreeItem): Promise<TodoTreeItem[]> {
        if (element && element.contextValue === 'file' && element.resourceUri) {
            return this.getTodosForFile(element.resourceUri);
        }

        return this.getFilesWithTodos();
    }

    private async getDocumentText(fileUri: vscode.Uri): Promise<string> {
        const openDoc = vscode.workspace.textDocuments.find(
            (doc) => doc.uri.toString() === fileUri.toString()
        );

        if (openDoc) {
            return openDoc.getText();
        }

        const doc = await vscode.workspace.openTextDocument(fileUri);
        return doc.getText();
    }

    /**
     * Fast & reliable workspace scan
     */
    private async getFilesWithTodos(): Promise<TodoTreeItem[]> {
        const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
        const fileItems: TodoTreeItem[] = [];

        for (const file of files) {
            try {
                const text = await this.getDocumentText(file);

                if (FILE_HAS_TODO_REGEX.test(text)) {
                    const fileName = vscode.workspace.asRelativePath(file);
                    fileItems.push(
                        new TodoTreeItem(
                            fileName,
                            vscode.TreeItemCollapsibleState.Expanded,
                            'file',
                            file
                        )
                    );
                }
            } catch (e) {
                // Skip unreadable files
            }
        }

        return fileItems;
    }

    /**
 * Prompts user to select from available settings flags or clear active flags
 */
    public async setFlagForTodo(item: TodoTreeItem): Promise<void> {
        if (!item.resourceUri || item.line === undefined) {
            return;
        }

        // 1. Get flags configured by the user in settings
        const flagSettings = vscode.workspace
            .getConfiguration('commentView')
            .get<Record<string, any>>('flags', {});

        const flagKeys = Object.keys(flagSettings);

        // 2. Build QuickPick options
        const quickPickItems: vscode.QuickPickItem[] = flagKeys.map((flagKey) => {
            const config = flagSettings[flagKey];
            const icon = config.icon ? `$(${config.icon}) ` : '';
            const isCurrentlyActive = item.activeFlags.includes(flagKey);

            return {
                label: `${icon}${flagKey}`,
                description: config.description || '',
                detail: isCurrentlyActive ? 'Currently active (click to remove)' : 'Click to apply'
            };
        });

        // Add option to clear all flags
        if (item.activeFlags.length > 0) {
            quickPickItems.unshift({
                label: '$(trash) Clear All Flags',
                description: '',
                detail: 'Removes all flag tags from this comment'
            });
        }

        // 3. Show QuickPick menu
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a flag to toggle or clear'
        });

        if (!selected) {
            return; // User cancelled
        }

        const document = await vscode.workspace.openTextDocument(item.resourceUri);
        const lineText = document.lineAt(item.line).text;
        let updatedText = lineText;

        if (selected.label.includes('Clear All Flags')) {
            // Strip trailing <...> flags
            updatedText = lineText.replace(/\s*<[^>]+>$/, '');
        } else {
            // Extract selected flag key name
            const chosenFlag = selected.label.replace(/\$\([^)]+\)\s*/, '').trim();

            // Remove existing trailing <...> block
            const baseText = lineText.replace(/\s*<[^>]+>$/, '');

            if (item.activeFlags.includes(chosenFlag)) {
                // Toggle off if already active
                const remainingFlags = item.activeFlags.filter((f) => f !== chosenFlag);
                updatedText = remainingFlags.length > 0
                    ? `${baseText} <${remainingFlags.join(', ')}>`
                    : baseText;
            } else {
                // Apply new flag (replacing or combining)
                updatedText = `${baseText} <${chosenFlag}>`;
            }
        }

        // Apply change to document
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            item.resourceUri,
            new vscode.Range(item.line, 0, item.line, lineText.length),
            updatedText
        );

        await vscode.workspace.applyEdit(edit);
        await document.save();
    }

    /**
     * Accurate line-by-line parsing for content and flags at line end
     */
    private async getTodosForFile(fileUri: vscode.Uri): Promise<TodoTreeItem[]> {
        const todoItems: TodoTreeItem[] = [];

        try {
            const text = await this.getDocumentText(fileUri);
            const lines = text.split(/\r?\n/);

            lines.forEach((lineText, index) => {
                const match = LINE_TODO_REGEX.exec(lineText);
                if (match) {
                    let fullTodoText = match[1].trim();
                    let activeFlags: string[] = [];

                    // Capture flags in <...> only if located at the end of the comment
                    const flagMatch = fullTodoText.match(/<([^>]+)>$/);
                    if (flagMatch) {
                        activeFlags = flagMatch[1]
                            .toLowerCase()
                            .split(',')
                            .map((f) => f.trim());

                        // Remove the flag block from the displayed label text
                        fullTodoText = fullTodoText.replace(/<([^>]+)>$/, '').trim();
                    }

                    const todoContent = fullTodoText || 'Empty TODO';

                    todoItems.push(
                        new TodoTreeItem(
                            todoContent,
                            vscode.TreeItemCollapsibleState.None,
                            'todo',
                            fileUri,
                            index,
                            activeFlags
                        )
                    );
                }
            });
        } catch (e) {
            // Ignore reading errors
        }

        return todoItems;
    }
}