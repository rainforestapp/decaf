GetCursorPosition = (el) ->
  pos = 0
  if "selectionStart" of el
    pos = el.selectionStart
  else if "selection" of document
    el.focus()
    Sel = document.selection.createRange()
    SelLength = document.selection.createRange().text.length
    Sel.moveStart "character", -el.value.length
    pos = Sel.text.length - SelLength
  pos

module.exports = GetCursorPosition
