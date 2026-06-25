// Counted body class for the duration of any drag in the canvas. Disables
// text selection and switches the cursor to grabbing globally — text remains
// selectable everywhere else when no drag is in progress.

let depth = 0

export const beginDrag = () => {
  if (depth++ === 0) document.body.classList.add('archgrid-dragging')
}

export const endDrag = () => {
  if (depth > 0 && --depth === 0) {
    document.body.classList.remove('archgrid-dragging')
  }
}
