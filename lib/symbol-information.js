const { SymbolKind, SymbolTag } = require('vscode-languageserver-types')
const { Convert } = require("../vendor/atom-languageclient")

module.exports = {
  symbolInformationToString({name, kind, tags, location}) {
    return `${symbolKindToString(kind)} ${name} ${tagsToString(tags)}in ${Convert.uriToPath(location.uri)}`.trim()
  }
}

function symbolKindToString(kind) {
  switch (kind) {
    case SymbolKind.Function:
      return "function"
    case SymbolKind.EnumMember:
      return "data constructor"
    case SymbolKind.Constructor:
      return "type constructor"
    case SymbolKind.Variable:
      return "hole"
    default:
      return ""
  }
}

function tagsToString(tags) {
  if (!tags) {
    return ""
  }

  const strings = tags.map(tagToString).filter(tag => tag)
  if (strings.length === 0) {
    return ""
  }
  return `(${tags.join(', ')}) `
}

function tagToString(tag) {
  switch (tag) {
    case SymbolTag.Deprecated:
      return "deprecated"
    default:
      return null
  }
}
