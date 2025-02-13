const { AutoLanguageClient } = require("../vendor/atom-languageclient")

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
}

module.exports = new IdrisLanguageClient()
