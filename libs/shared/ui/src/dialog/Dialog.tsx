import React from 'react'

import { cn } from '../lib/utils'
import { Modal, type ModalProps } from '../primitives'

// The app's global CSS keys dialog centering, animations, and the full-screen
// escape hatches on the `dialog-content` / `dialog-overlay` marker classes; the
// plain Modal part does not emit them.
const Dialog: React.FC<ModalProps> = ({ classNames, ...props }) => (
  <Modal
    classNames={{
      ...classNames,
      content: cn('dialog-content', classNames?.content),
      overlay: cn('dialog-overlay', classNames?.overlay),
    }}
    {...props}
  />
)

export default Dialog
