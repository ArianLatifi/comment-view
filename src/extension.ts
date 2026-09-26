import * as vscode from 'vscode';
import { TodoTreeDataProvider, TodoTreeItem } from './todoprovider';

export function activate(context: vscode.ExtensionContext) {
  const todoDataProvider = new TodoTreeDataProvider();

  vscode.window.registerTreeDataProvider('commentView', todoDataProvider);

  let debounceTimer: NodeJS.Timeout | undefined;

  // Helper function to trigger a debounced refresh
  const triggerRefresh = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      todoDataProvider.refresh();
    }, 300); // Waits 300ms after last edit/save
  };

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('commentView.flags')) {
      todoDataProvider.refresh();
    }
  });

  context.subscriptions.push(configWatcher);
  const toggleDoneCommand = vscode.commands.registerCommand(
    'comment-view.toggleDone',
    async (item: TodoTreeItem) => {
      if (item) {
        await todoDataProvider.toggleTodoStatus(item);
        todoDataProvider.refresh();
      }
    }
  );
  const setFlagCommand = vscode.commands.registerCommand(
    'comment-view.setFlag',
    async (item: TodoTreeItem) => {
      if (item) {
        await todoDataProvider.setFlagForTodo(item);
        todoDataProvider.refresh();
      }
    }
  );

  context.subscriptions.push(setFlagCommand);
  context.subscriptions.push(toggleDoneCommand);
  // 1. Listen for typing/content edits in active tabs
  const onChangeSubscription = vscode.workspace.onDidChangeTextDocument(() => {
    triggerRefresh();
  });

  // 2. Listen for document saves
  const onSaveSubscription = vscode.workspace.onDidSaveTextDocument(() => {
    triggerRefresh();
  });

  // 3. Listen for tab switches
  const onActiveEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
    triggerRefresh();
  });

  // 4. File system watcher for creation/deletion of files
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  fileWatcher.onDidCreate(() => triggerRefresh());
  fileWatcher.onDidDelete(() => triggerRefresh());

  context.subscriptions.push(
    onChangeSubscription,
    onSaveSubscription,
    onActiveEditorSubscription,
    fileWatcher
  );
}

export function deactivate() { }