export function isActiveElementEditing(doc: Document = document): boolean {
  return isEditingElement(doc.activeElement)
}

export function isEventTargetEditing(target: EventTarget | null): boolean {
  return target instanceof Element ? isEditingElement(target) : false
}

/**
 * True when the event target OR the document's active element is an editable field that already
 * holds text. An empty field owns no cursor movement and cannot send, so arrow keys and Enter can
 * still drive a page-level list while it keeps focus -- once the user has typed, the keys belong
 * to the text.
 */
export function isTypingInEditableField(
  event: { target: EventTarget | null },
  doc: Document = document,
): boolean {
  return isNonEmptyEditingElement(event.target) || isNonEmptyEditingElement(doc.activeElement)
}

function isEditingElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  const tagName = element.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true
  }

  if (element.isContentEditable) {
    return true
  }

  // Covers nested editors where the direct target is not the editable root.
  return Boolean(element.closest('[contenteditable=""], [contenteditable="true"]'))
}

function isNonEmptyEditingElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !isEditingElement(target)) {
    return false
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value.trim().length > 0
  }

  return (target.textContent ?? '').trim().length > 0
}
