const { AutoLanguageClient, CommandExecutionAdapter, Convert, ApplyEditAdapter, WorkspaceEdit, Command } = require("../vendor/atom-languageclient")
const { Disposable, TextBuffer } = require("atom")
const SelectListView = require('atom-select-list')

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
    const commandsDisposable = atom.commands.add('atom-text-editor', {
      // https://github.com/bamboo/idris2-lsp-vscode/blob/1e9339224fbf4cc5b5d236e683c3285901b2faf3/src/extension.ts#L101
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
      },
      // https://github.com/bamboo/idris2-lsp-vscode/blob/1e9339224fbf4cc5b5d236e683c3285901b2faf3/src/extension.ts#L220
      'pulsar-idris-lsp:go-to-hole': async () => {
        const editor = atom.workspace.getActiveTextEditor()

        const selectList = new SelectListView({
          items: [],
          elementForItem({label}, {selected}) {
            const element = document.createElement('li')
            element.textContent = label
            return element
          },
          filterKeyForItem({label}) {
            return label
          },
          emptyMessage: 'No holes',
          loadingMessage: 'Loading holes',
          async didConfirmSelection({metavar}) {
            const location = metavar.location
            const path = Convert.uriToPath(location.uri)
            const position = Convert.positionToPoint(location.range.start)
            await atom.workspace.open(path, {initialLine: position.row, initialColumn: position.column})
            modal.destroy()
            selectList.destroy()
            previouslyFocusedElement.focus()
          },
          didCancelSelection() {
            modal.destroy()
            selectList.destroy()
            previouslyFocusedElement.focus()
          }
        })

        const previouslyFocusedElement = document.activeElement

        const modal = atom.workspace.addModalPanel({
          item: selectList,
          // autoFocus: true, // QUESTION: Shouldn't this work?
        })

        selectList.focus()

        let result = await CommandExecutionAdapter.executeCommand(
          await this.getConnectionForEditor(editor),
          "metavars",
          [],
        )

        if (!Array.isArray(result)) {
          result = []
          this.logger.error('Result of executing metavars command is not an array')
        }

        const items = result.map(metavar => ({
          label: `${metavar.name} : ${metavar.type}`,
          metavar: metavar
        }))

        await selectList.update({items, loadingMessage: null})
      },
      // https://github.com/idris-community/idris2-nvim/blob/fd051fa8dde6541a6d345e020a05d2cc8f7a3f8d/lua/idris2/code_action.lua#L140
      'pulsar-idris-lsp:expression-search-with-hints': () => {
        const editor = atom.workspace.buildTextEditor({mini: true})
        const helpMessage = document.createElement('p')
        helpMessage.textContent = 'Enter function names (hints) that you want expression search to use, separated by commas'
        const modalContent = document.createElement('div')
        modalContent.appendChild(editor.element)
        modalContent.appendChild(helpMessage)

        function close() {
          modal.destroy()
          editorCommandsDisposable.dispose()
          editor.destroy()
          previouslyFocusedElement.focus()
        }

        const activeEditor = atom.workspace.getActiveTextEditor()
        const editorCommandsDisposable = atom.commands.add(editor.element, {
          'core:confirm': async () => {
            const hints = editor.getText().split(',').map(hint => hint.trim())
            const range = activeEditor.getSelectedBufferRange()
            const codeActionParams = {
              textDocument: Convert.editorToTextDocumentIdentifier(activeEditor),
              range: Convert.atomRangeToLSRange(range),
              context: {
                diagnostics: [],
              },
            }
            const selectList = new SelectListView({
              items: [],
              elementForItem({title: label}, {selected}) {
                const element = document.createElement('li')
                element.textContent = label
                return element
              },
              filterKeyForItem({title: label}) {
                return label
              },
              emptyMessage: 'No results found',
              loadingMessage: 'Loading results',
              didConfirmSelection: async (codeAction) => {
                if (WorkspaceEdit.is(codeAction.edit)) {
                  await ApplyEditAdapter.apply(codeAction.edit)
                }
                if (Command.is(codeAction.command)) {
                  const result = await CommandExecutionAdapter.executeCommand(
                    await this.getConnectionForEditor(activeEditor),
                    codeAction.command.command,
                    codeAction.command.arguments,
                  )
                  this.logger.warn(`dropping result of command ${JSON.stringify(codeAction.command)} on the floor: ${JSON.stringify(result)}`)
                }
                close()
                selectList.destroy()
              },
              didCancelSelection() {
                close()
                selectList.destroy()
              }
            })
            modal.destroy()
            modal = atom.workspace.addModalPanel({item: selectList})
            selectList.focus()
            const result = await CommandExecutionAdapter.executeCommand(
              await this.getConnectionForEditor(activeEditor),
              "exprSearchWithHints",
              [{codeAction: codeActionParams, hints}],
            )
            selectList.update({items: result || [], loadingMessage: null})
          },
          'core:cancel': () => {
            close()
          },
        });
        let modal = atom.workspace.addModalPanel({
          item: modalContent,
          visible: false,
        })
        modal.onDidChangeVisible(isVisible => {
          if (!isVisible) {
            close()
          }
        })
        const previouslyFocusedElement = document.activeElement
        modal.show()
        editor.element.focus()
      },
      'pulsar-idris-lsp:refine-hole': {
        description: 'Replace a hole with an application of a provided hint (function name) to arguments that are holes',
        didDispatch: () => {
          const editor = atom.workspace.buildTextEditor({mini: true})
          const helpMessage = document.createElement('p')
          helpMessage.textContent = 'Enter function name (hint) to refine hole with'
          const modalContent = document.createElement('div')
          modalContent.appendChild(editor.element)
          modalContent.appendChild(helpMessage)

          function close() {
            modal.destroy()
            editorCommandsDisposable.dispose()
            editor.destroy()
            previouslyFocusedElement.focus()
          }

          const activeEditor = atom.workspace.getActiveTextEditor()
          const editorCommandsDisposable = atom.commands.add(editor.element, {
            'core:confirm': async () => {
              const hint = editor.getText().trim()
              const range = activeEditor.getSelectedBufferRange()
              const codeActionParams = {
                textDocument: Convert.editorToTextDocumentIdentifier(activeEditor),
                range: Convert.atomRangeToLSRange(range),
                context: {
                  diagnostics: [],
                },
              }
              const selectList = new SelectListView({
                items: [],
                elementForItem({title: label}, {selected}) {
                  const element = document.createElement('li')
                  element.textContent = label
                  return element
                },
                filterKeyForItem({title: label}) {
                  return label
                },
                emptyMessage: 'No result found',
                loadingMessage: 'Loading result',
                didConfirmSelection: async (codeAction) => {
                  if (WorkspaceEdit.is(codeAction.edit)) {
                    await ApplyEditAdapter.apply(codeAction.edit)
                  }
                  if (Command.is(codeAction.command)) {
                    const result = await CommandExecutionAdapter.executeCommand(
                      await this.getConnectionForEditor(activeEditor),
                      codeAction.command.command,
                      codeAction.command.arguments,
                    )
                    this.logger.warn(`dropping result of command ${JSON.stringify(codeAction.command)} on the floor: ${JSON.stringify(result)}`)
                  }
                  close()
                  selectList.destroy()
                },
                didCancelSelection() {
                  close()
                  selectList.destroy()
                }
              })
              modal.destroy()
              modal = atom.workspace.addModalPanel({item: selectList})
              selectList.focus()
              const result = await CommandExecutionAdapter.executeCommand(
                await this.getConnectionForEditor(activeEditor),
                "refineHole",
                [{codeAction: codeActionParams, hint}],
              )
              selectList.update({items: result || [], loadingMessage: null})
            },
            'core:cancel': () => {
              close()
            },
          });
          // TODO: Focus management: watch what happens when switching from
          // this modal straight to the command palette (using a keybinding).
          // Focus goes to the active editor.
          let modal = atom.workspace.addModalPanel({
            item: modalContent,
            visible: false,
          })
          modal.onDidChangeVisible(isVisible => {
            if (!isVisible) {
              close()
            }
          })
          const previouslyFocusedElement = document.activeElement
          modal.show()
          editor.element.focus()
        }
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
