const { AutoLanguageClient, CommandExecutionAdapter } = require("../vendor/atom-languageclient")
const { Disposable, TextBuffer } = require("atom")

class IdrisLanguageClient extends AutoLanguageClient {
  getGrammarScopes() {
    return ["source.idris", "source.ipkg", "source.idris.literate"]
  }
  getLanguageName() {
    return "Idris"
  }
  getServerName() {
    return "IdrisLSP"
  }

  startServerProcess() {
    return super.spawn(
      "bash", // the `name` or `path` of the executable
      // if the `name` is provided it checks `bin/platform-arch/exeName` by default, and if doesn't exists uses the `exeName` on the PATH
      ["-i", "idris2-lsp"], // args passed to spawn the exe
      { cwd: this.projectPath } // child process spawn options
    )
  }

  activate() {
    super.activate()
    let marker = null, decoratorEditor = null, decoration = null;
    // https://github.com/bamboo/idris2-lsp-vscode/blob/1e9339224fbf4cc5b5d236e683c3285901b2faf3/src/extension.ts#L101
    const commandsDisposable = atom.commands.add('atom-text-editor', {
      'pulsar-idris-lsp:evaluate-in-repl': async () => {
        const editor = atom.workspace.getActiveTextEditor()
        const code = editor.getSelectedText()
        marker && marker.destroy()
        decoratorEditor && decoratorEditor.destroy()
        decoration && decoration.destroy()
        if (code.length === 0) {
          return
        }
        marker = editor.markBufferRange(editor.getSelectedBufferRange(), {
          invalidate: 'inside'
        })
        let result, isSuccess = false;
        try {
          result = await CommandExecutionAdapter.executeCommand(
            await this.getConnectionForEditor(editor),
            "repl",
            [code]
          )
          isSuccess = true;
        } catch (err) {
          result = `${err}`
        }
        const decoratorBuffer = new TextBuffer({text: result.trimEnd()})
        decoratorEditor = atom.workspace.buildTextEditor({
          buffer: decoratorBuffer,
          editorWidthInChars: 40,
          lineNumberGutterVisible: false,
          readOnly: true,
          softWrapped: true,
        })
        if (isSuccess) {
          const grammar = atom.grammars.grammarForScopeName('source.idris')
          // TextEditor.setGrammar is deprecated
          decoratorBuffer.setLanguageMode(
            atom.grammars.languageModeForGrammarAndBuffer(grammar, decoratorBuffer)
          );
        }
        const element = decoratorEditor.getElement()
        // TODO: Try autoWidth and autoHeight
        element.onDidAttach(() => {
          element.measureDimensions()
          element.setWidth(decoratorEditor.getEditorWidthInChars() * element.getDefaultCharacterWidth())
          element.setHeight(element.getComponent().getContentHeight())
        })
        decoration = editor.decorateMarker(marker, {
          class: 'overlay',
          item: element,
          type: 'overlay',
        })
      }
    })
    this._disposable.add(commandsDisposable);
    this._disposable.add(new Disposable(() => {
      marker && marker.destroy()
      decoratorEditor && decoratorEditor.destroy()
      decoration && decoration.destroy()
    }))
  }
}

module.exports = new IdrisLanguageClient()
