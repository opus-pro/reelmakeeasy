'use client'

import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { toast } from '@shared/ui'
import {
  OutdatedCollapsedHeader,
  OutdatedCollapseToggle,
  UpdatedStatusBadge,
} from '@shared/ui/artifact-panel'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import {
  getApiAtom,
  getBrandBriefBankAssetsAtom,
  getBrandBriefDraftAtom,
  getBrandBriefDraftEditedAtom,
  getBrandBriefSubmittedAtom,
  getBrandPendingUploadsAtom,
} from '../state/atoms/planner'
import { getBrandReviewGateAtom } from '../state/computed/planner'
import { usePlannerState } from '../state/planner-context'
import type { BrandBriefAsset, BrandBriefCardBlock, BrandBriefDraft } from '../state-types'

import { AssetsSection } from './AssetsSection'
import { BrandStylesPicker } from './BrandStylesPicker'
import { useSavedBrandStyles } from './useSavedBrandStyles'

interface BrandBriefCardBlockItemProps {
  block: BrandBriefCardBlock
  // When true (uid_revamp canvas Brand-section History preview), render an
  // outdated snapshot expanded rather than collapsed behind OutdatedCollapsedHeader. The
  // fields stay read-only and never publish to the shared draft/bank atoms because those
  // are already gated on isOutdated -- previewMode only overrides the auto-collapse.
  previewMode?: boolean
  // When false (the uid_revamp canvas Brand section), the internal title/subheading/badge
  // header is suppressed because ArtifactSection owns the title, subheading and Updated
  // badge. Defaults to true so the legacy chat timeline is unchanged.
  showHeader?: boolean
  // 'card' (default) is the legacy chat timeline: a boxed brief with its own gray surround.
  // 'plain' is the uid_revamp canvas Brand section: no surrounding box (ArtifactSection
  // frames it) so the fields are not rendered as a box-in-a-box.
  variant?: 'card' | 'plain'
}

const INPUT_BASE_CLASSES =
  'w-full rounded-sm border border-subtle bg-black/15 px-4 py-3 text-base leading-6 text-primary placeholder:text-primary/30 focus:border-primary/30 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'

const LABEL_CLASSES = 'text-xs font-medium uppercase tracking-wider text-primary/50'

interface BrandBriefHeaderProps {
  block: BrandBriefCardBlock
  isCollapsed: boolean
  onToggleCollapse: () => void
}

interface StatusMessageProps {
  block: BrandBriefCardBlock
}

interface TextFieldProps {
  disabled: boolean
  label: string
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

export function BrandBriefCardBlockItem({
  block,
  previewMode = false,
  showHeader = true,
  variant = 'card',
}: BrandBriefCardBlockItemProps) {
  const isPlain = variant === 'plain'
  const state = usePlannerState()
  const setDraftAtom = useSetAtom(getBrandBriefDraftAtom(state))
  const setBankAssetsAtom = useSetAtom(getBrandBriefBankAssetsAtom(state))
  const isSubmitted = useAtomValue(getBrandBriefSubmittedAtom(state))
  const brandReviewGate = useAtomValue(getBrandReviewGateAtom(state))
  // `hasUserEdited` lives in an atom (not local state) so the send-queue
  // action can read it to decide whether to flush the draft alongside a
  // chat message, and reset it after a successful flush.
  const hasUserEdited = useAtomValue(getBrandBriefDraftEditedAtom(state))
  const setHasUserEdited = useSetAtom(getBrandBriefDraftEditedAtom(state))
  const isOutdated = block.blockStatus === 'outdated'
  // Outdated snapshots are historical -- the user can expand them to compare
  // against the current state but inputs are read-only. Editing one would
  // contaminate the shared draft atom and flush stale values on next send.
  const isEditable =
    !isSubmitted &&
    !isOutdated &&
    !!brandReviewGate &&
    (block.status === 'review_ready' || block.status === 'failed')
  const isDisabled = !isEditable
  // A previewed snapshot renders expanded (read-only) rather than collapsed.
  const [isCollapsed, setIsCollapsed] = useState(isOutdated && !previewMode)

  const parsed = useMemo(() => buildInitialDraft(block.brandBank), [block.brandBank])
  const [draft, setDraft] = useState<BrandBriefDraft>(parsed)
  const blobUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (!hasUserEdited) {
      setDraft(parsed)
    }
  }, [hasUserEdited, parsed])

  useEffect(() => {
    // Only the live (non-outdated) card owns the shared draft-edited flag.
    // Outdated card mounts (e.g., after a LUI update demotes a previous
    // snapshot) must not reset this -- that would wipe pending edits the
    // user is currently making on the live card.
    // brandBankLockedAt is the reset trigger rather than block.id: normal
    // SSE pushes during brand_review change block.id but not locked_at,
    // so they no longer wipe user edits. locked_at only changes when a new
    // lock_brand_bank patch lands (confirm or new extraction cycle).
    if (isOutdated) {
      return
    }
    setHasUserEdited(false)
  }, [block.brandBankLockedAt, isOutdated, setHasUserEdited])

  useEffect(() => {
    setIsCollapsed(isOutdated && !previewMode)
  }, [block.id, isOutdated, previewMode])

  useEffect(
    () => () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrlsRef.current = []
    },
    [],
  )

  const updateDraft = useCallback(
    (updater: (prev: BrandBriefDraft) => BrandBriefDraft) => {
      setHasUserEdited(true)
      setDraft(updater)
    },
    [setHasUserEdited],
  )

  // Publish latest draft + bank snapshot to shared atoms so flow-actions
  // can diff draft.assets against the original bank at Continue/send time
  // and emit add_asset / remove_asset edits. Outdated cards never publish.
  useEffect(() => {
    if (isOutdated) {
      return
    }
    setDraftAtom(draft)
  }, [draft, isOutdated, setDraftAtom])

  useEffect(() => {
    if (isOutdated) {
      return
    }
    setBankAssetsAtom(getStagedAssets(block.brandBank))
  }, [block.brandBank, isOutdated, setBankAssetsAtom])

  const api = useAtomValue(getApiAtom(state))
  const setPendingUploads = useSetAtom(getBrandPendingUploadsAtom(state))

  // A reused saved brief shows that brand's own saved styles; a
  // fresh brand keeps the preset style it was created with -- no style section.
  // Fetched client-side from the brand-library list keyed by the
  // brief id threaded onto the block.
  const selectedStyleInput = useMemo(
    () => ({
      name: block.selectedStyleName,
      text: block.selectedStyleText,
      thumbnailUrl: block.styleThumbnailUrl,
    }),
    [block.selectedStyleName, block.selectedStyleText, block.styleThumbnailUrl],
  )
  const {
    defaultStyleId: savedStyleDefaultId,
    loading: savedStylesLoading,
    styles: savedStyles,
  } = useSavedBrandStyles(block.fromSavedBrief ? block.savedBriefId : null, selectedStyleInput)

  const handlePickAsset = useCallback(
    async (file: File, kind: BrandBriefAsset['kind']) => {
      if (!api) {
        return
      }
      const [uploadPromise] = api.uploadFiles([file])
      const previewUrl = URL.createObjectURL(file)
      blobUrlsRef.current.push(previewUrl)
      const pendingId = `pending-${Date.now()}-${file.name}`
      updateDraft((prev) => ({
        ...prev,
        assets: [
          ...prev.assets,
          {
            description: null,
            id: pendingId,
            kind,
            pendingDescription: file.name,
            previewUrl,
            provenance: 'user_upload',
            remoteUri: null,
          },
        ],
      }))
      // Wrap upload + draft-update so flush sites can await this single
      // promise and be sure pendingStorePath is set on the draft entry by
      // the time snapshotBrandDraftEdits reads it.
      const finalizePromise = uploadPromise
        .then((uploaded) => {
          updateDraft((prev) => ({
            ...prev,
            assets: prev.assets.map((asset) =>
              asset.id === pendingId ? { ...asset, pendingStorePath: uploaded.file_path } : asset,
            ),
          }))
        })
        .catch(() => {
          toast.error('Failed to upload asset. Please try again.')
          updateDraft((prev) => ({
            ...prev,
            assets: prev.assets.filter((asset) => asset.id !== pendingId),
          }))
        })
        .finally(() => {
          setPendingUploads((prev) => {
            const next = new Map(prev)
            next.delete(pendingId)
            return next
          })
        })
      setPendingUploads((prev) => new Map(prev).set(pendingId, finalizePromise))
      await finalizePromise
    },
    [api, setPendingUploads, updateDraft],
  )

  const handleRemoveAssets = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids)
      updateDraft((prev) => ({ ...prev, assets: prev.assets.filter((a) => !idSet.has(a.id)) }))
    },
    [updateDraft],
  )

  const handleChangeKind = useCallback(
    (id: string, kind: BrandBriefAsset['kind']) => {
      updateDraft((prev) => ({
        ...prev,
        assets: prev.assets.map((a) => (a.id === id ? { ...a, kind } : a)),
      }))
    },
    [updateDraft],
  )

  if (isOutdated && isCollapsed && !previewMode) {
    return (
      <section className="w-full overflow-hidden rounded-2xl border border-subtle p-6">
        <OutdatedCollapsedHeader
          isCollapsed={isCollapsed}
          label={block.title}
          onToggle={() => setIsCollapsed((value) => !value)}
        />
      </section>
    )
  }

  return (
    <section
      className={
        isPlain
          ? 'flex w-full flex-col gap-6'
          : isOutdated
            ? 'flex w-full flex-col gap-6 rounded-2xl border border-subtle p-6'
            : 'flex w-full flex-col gap-6 rounded-2xl border border-transparent bg-fill-disabled p-6'
      }
    >
      {showHeader ? (
        <BrandBriefHeader
          block={block}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed((value) => !value)}
        />
      ) : null}

      {isCollapsed ? null : (
        <>
          <StatusMessage block={block} />
          <TextField
            disabled={isDisabled}
            label="Brand name"
            onChange={(value) => updateDraft((prev) => ({ ...prev, businessName: value }))}
            placeholder="e.g. NeuroBrew"
            value={draft.businessName}
          />
          <TextareaField
            disabled={isDisabled}
            label="Brand summary"
            onChange={(value) => updateDraft((prev) => ({ ...prev, aboutUsSummary: value }))}
            placeholder="One paragraph about the brand"
            value={draft.aboutUsSummary}
          />
          <TextField
            disabled={isDisabled}
            label="Key message to audience"
            onChange={(value) => updateDraft((prev) => ({ ...prev, ctaLabel: value }))}
            placeholder="e.g. Subscribe channel"
            value={draft.ctaLabel}
          />
          {block.fromSavedBrief && (savedStylesLoading || savedStyles.length > 0) ? (
            <BrandStylesPicker
              defaultStyleId={savedStyleDefaultId}
              disabled={isDisabled}
              loading={savedStylesLoading}
              styles={savedStyles}
            />
          ) : null}
          <AssetsSection
            assets={draft.assets}
            disabled={isDisabled}
            onChangeKind={handleChangeKind}
            onPick={handlePickAsset}
            onRemoveMultiple={handleRemoveAssets}
          />
        </>
      )}
    </section>
  )
}

function BrandBriefHeader({ block, isCollapsed, onToggleCollapse }: BrandBriefHeaderProps) {
  const isOutdated = block.blockStatus === 'outdated'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <h3
          className="text-lg font-semibold leading-snug text-primary"
          style={FONT_FEATURE_SETTINGS}
        >
          {block.title}
        </h3>
        {block.status === 'review_ready' ? (
          <p
            className="text-sm font-normal leading-snug text-secondary"
            style={FONT_FEATURE_SETTINGS}
          >
            Review your brand brief, edit directly or ask agent to edit
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {block.blockStatus === 'updated' ? <UpdatedStatusBadge /> : null}
        {isOutdated ? (
          <OutdatedCollapseToggle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
        ) : null}
      </div>
    </div>
  )
}

function buildInitialDraft(bank: unknown): BrandBriefDraft {
  const empty: BrandBriefDraft = {
    aboutUsSummary: '',
    assets: [],
    businessName: '',
    ctaHref: '',
    ctaLabel: '',
  }
  if (!isRecord(bank)) {
    return empty
  }
  const basicInfo = isRecord(bank.basic_info) ? bank.basic_info : {}
  const ctas = Array.isArray(bank.ctas) ? bank.ctas : []
  const firstCta = ctas[0]
  const stagedAssets = isRecord(bank.staged_assets) ? bank.staged_assets : {}
  const assets: BrandBriefAsset[] = []
  for (const [kind, value] of Object.entries(stagedAssets)) {
    if (!Array.isArray(value)) {
      continue
    }
    value.forEach((entry, index) => {
      if (!isRecord(entry)) {
        return
      }
      const uri = typeof entry.staging_uri === 'string' ? entry.staging_uri : null
      const sourceUrl = typeof entry.source_url === 'string' ? entry.source_url : null
      // Prefer an optional `viewable_url` beside the path; `staging_uri` stays
      // the stored identity and is the usual source of the preview.
      const viewableUrl = typeof entry.viewable_url === 'string' ? entry.viewable_url : null
      const previewUrl = storeUriToUrl(viewableUrl ?? uri ?? sourceUrl ?? '')
      if (!previewUrl) {
        return
      }
      const assetKind: BrandBriefAsset['kind'] =
        kind === 'character' || kind === 'product' ? kind : 'logo'
      const provenance: BrandBriefAsset['provenance'] =
        entry.provenance === 'user_upload' ? 'user_upload' : 'crawl'
      const description = typeof entry.description === 'string' ? entry.description : null
      assets.push({
        // Keyed on the STORED uri, never on `previewUrl`. That
        // URL's query string can change between reads, and this id is
        // both the React key and how the draft's select / remove / re-kind
        // handlers find a row -- a churning id would remount every tile and
        // silently drop an in-flight edit.
        description,
        id: `${kind}-${index}-${uri ?? sourceUrl ?? ''}`,
        kind: assetKind,
        previewUrl,
        provenance,
        remoteUri: uri,
      })
    })
  }
  return {
    aboutUsSummary: stringOrEmpty(basicInfo.about_us_summary),
    assets,
    businessName: stringOrEmpty(basicInfo.business_name),
    ctaHref: isRecord(firstCta) && typeof firstCta.href === 'string' ? firstCta.href : '',
    ctaLabel: isRecord(firstCta) ? stringOrEmpty(firstCta.label) : '',
  }
}

function getStagedAssets(bank: unknown): unknown {
  if (!isRecord(bank)) {
    return null
  }
  return bank.staged_assets ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function StatusMessage({ block }: StatusMessageProps) {
  if (block.status === 'in_progress') {
    return (
      <p className="text-sm text-white/60" style={FONT_FEATURE_SETTINGS}>
        Pulling your brand details together. This usually takes a minute or two.
      </p>
    )
  }
  if (block.status === 'failed') {
    return (
      <p className="text-sm text-red-300" style={FONT_FEATURE_SETTINGS}>
        Could not finish brand extraction
        {block.failureReason ? ` (${block.failureReason})` : ''}. You can edit the fields below
        manually.
      </p>
    )
  }
  return null
}

function stringOrEmpty(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  const lowered = value.trim().toLowerCase()
  if (lowered === 'null' || lowered === 'none') {
    return ''
  }
  return value
}

function TextareaField({ disabled, label, onChange, placeholder, value }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className={LABEL_CLASSES} style={FONT_FEATURE_SETTINGS}>
        {label}
      </span>
      <textarea
        className={`${INPUT_BASE_CLASSES} min-h-[120px] resize-none`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        style={FONT_FEATURE_SETTINGS}
        value={value}
      />
    </label>
  )
}

function TextField({ disabled, label, onChange, placeholder, value }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className={LABEL_CLASSES} style={FONT_FEATURE_SETTINGS}>
        {label}
      </span>
      <input
        className={INPUT_BASE_CLASSES}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={FONT_FEATURE_SETTINGS}
        type="text"
        value={value}
      />
    </label>
  )
}
