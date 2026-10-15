import React from 'react'
import { useTranslation } from 'react-i18next'

import CloseButton from '../CloseButton'
import { cn } from '../lib/utils'
import { Modal, type ModalAlertConfig, type ModalAlertHandle } from '../primitives'

// Resolved inside the rendered tree so the label follows the active i18n
// language, matching the hook the pre-shim AlertDialog used.
const DefaultConfirmLabel = (): React.ReactElement => {
  const { t } = useTranslation('common')
  return <>{t('common:confirm')}</>
}

export default function alert(config: ModalAlertConfig): ModalAlertHandle {
  const { classNames, ...rest } = config
  return Modal.alert({
    closeIcon: <CloseButton />,
    confirmText: config.confirmText ?? <DefaultConfirmLabel />,
    ...rest,
    classNames: {
      ...classNames,
      content: cn('max-sm:z-[9999]', classNames?.content),
      description: cn('whitespace-pre-wrap max-sm:text-left', classNames?.description),
      title: cn('text-[#FAFAFA]', classNames?.title),
    },
  })
}
