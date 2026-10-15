import type { ModalAlertConfig } from '../primitives'

import alert from './alert'
import BaseDialog from './Dialog'

type DialogProps = typeof BaseDialog & { alert: typeof alert }

const Dialog = BaseDialog as DialogProps
Dialog.alert = alert

export default Dialog

export type AlertDialogProps = ModalAlertConfig
