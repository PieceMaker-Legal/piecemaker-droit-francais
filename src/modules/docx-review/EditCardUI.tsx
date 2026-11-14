"use client";

import type { ReactNode } from "react";

import { PillButtonUI, TextButtonUI, TextSlabUI } from "@/modules/docx-review/controls";

export type EditCardUIBusyAction =
    | "view"
    | "apply"
    | "accept"
    | "reject"
    | "accept-and-apply";

export type EditCardUIProps = {
    originalText?: string;
    replacementText?: string;
    /**
     * Replaces the default red/green diff inside the text slab — for changes
     * that keep the text but restyle it (e.g. Word formatting cards).
     */
    previewContent?: ReactNode;
    reason?: string;
    /**
     * Where the change landed: a snippet of its surrounding passage, shown
     * under the diff so a wrong-location edit is catchable before Accept.
     */
    locationHint?: string;
    changeNumber?: number;
    status?: string;
    statusMessage?: string;
    statusMessageClassName?: string;
    ariaBusy?: boolean;
    className?: string;
    actionsDisabled?: boolean;
    busyAction?: EditCardUIBusyAction;
    onView?: () => void;
    onApply?: () => void;
    onAccept?: () => void;
    onReject?: () => void;
    onAcceptAndApply?: () => void;
    /** Renders the dismiss control. Omit where the card cannot be closed. */
    onClose?: () => void;
}

/**
 * Platform-neutral tracked-change card. Data loading, authentication, document
 * mutation, and status transitions belong to the host wrapper.
 */
export function EditCardUI({
    originalText,
    replacementText,
    previewContent,
    reason,
    locationHint,
    changeNumber,
    status,
    statusMessage,
    statusMessageClassName = "",
    ariaBusy = false,
    className = "",
    actionsDisabled = false,
    busyAction,
    onClose,
    onView,
    onApply,
    onAccept,
    onReject,
    onAcceptAndApply,
}: EditCardUIProps) {
    const hasEditText =
        replacementText !== undefined || originalText !== undefined;
    const hasReplacement =
        replacementText !== undefined && replacementText !== "";
    const hasOriginal = originalText !== undefined && originalText !== "";
    const resolved = status === "accepted" || status === "rejected";
    const controlsDisabled = actionsDisabled || busyAction !== undefined;
    const showApply = !!onApply || busyAction === "apply";
    const showAcceptAndApply =
        !!onAcceptAndApply || busyAction === "accept-and-apply";
    const hasActions =
        !!onClose ||
        !!onView ||
        showApply ||
        showAcceptAndApply ||
        !!onAccept ||
        !!onReject;

    return (
        <div
            className={className}
            data-edit-status={status}
            aria-busy={ariaBusy || busyAction !== undefined || undefined}
        >
            {(changeNumber !== undefined || reason) && (
                <div className="mb-2 flex items-start gap-2">
                    {changeNumber !== undefined && (
                        <span
                            aria-label={`Modification ${changeNumber}`}
                            title={`Modification ${changeNumber}`}
                            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center self-start rounded-full bg-muted text-[9px] font-medium leading-none text-muted-foreground"
                        >
                            {changeNumber}
                        </span>
                    )}
                    {reason && (
                        <p className="min-w-0 flex-1 font-serif text-sm text-muted-foreground">
                            {reason}
                        </p>
                    )}
                </div>
            )}

            {(hasEditText || previewContent !== undefined) && (
                // Long changes scroll inside the slab so the actions stay in
                // view; focusable so the scroll is reachable by keyboard.
                <TextSlabUI
                    tabIndex={0}
                    className="max-h-40 overflow-y-auto overscroll-contain font-sans text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                    {previewContent !== undefined ? (
                        previewContent
                    ) : (
                        <>
                            {hasReplacement && (
                                <span className="text-green-700">
                                    {replacementText}
                                </span>
                            )}
                            {hasReplacement && hasOriginal && " "}
                            {hasOriginal && (
                                <span className="text-red-600 line-through">
                                    {originalText}
                                </span>
                            )}
                        </>
                    )}
                </TextSlabUI>
            )}

            {locationHint && (
                <p
                    className="mt-1 truncate font-sans text-[11px] text-muted-foreground"
                    title={locationHint}
                >
                    Dans : «{locationHint}”
                </p>
            )}

            {hasActions && (
                <div
                    className="mt-2 flex items-center gap-2"
                    role="group"
                    aria-label="Actions de modification"
                >
                    {showAcceptAndApply && (
                        <PillButtonUI
                            tone="blue"
                            size="xs"
                            onClick={onAcceptAndApply}
                            disabled={
                                controlsDisabled || !onAcceptAndApply
                            }
                            loading={busyAction === "accept-and-apply"}
                        >
                            {busyAction === "accept-and-apply" ? (
                                "Acceptation…"
                            ) : (
                                "Accepter et appliquer"
                            )}
                        </PillButtonUI>
                    )}
                    {showApply && (
                        <PillButtonUI
                            tone="blue"
                            size="xs"
                            onClick={onApply}
                            disabled={controlsDisabled || !onApply}
                            loading={busyAction === "apply"}
                        >
                            {busyAction === "apply" ? (
                                "Application…"
                            ) : (
                                "Appliquer"
                            )}
                        </PillButtonUI>
                    )}
                    {onAccept && (
                        <PillButtonUI
                            tone="blue"
                            size="xs"
                            onClick={onAccept}
                            disabled={controlsDisabled || resolved}
                            loading={busyAction === "accept"}
                        >
                            {busyAction === "accept" ? (
                                "Acceptation…"
                            ) : status === "accepted" ? (
                                "Acceptée"
                            ) : (
                                "Accepter"
                            )}
                        </PillButtonUI>
                    )}
                    {onReject && (
                        <PillButtonUI
                            tone="white"
                            size="xs"
                            onClick={onReject}
                            disabled={controlsDisabled || resolved}
                            loading={busyAction === "reject"}
                        >
                            {busyAction === "reject" ? (
                                "Refus…"
                            ) : status === "rejected" ? (
                                "Refusée"
                            ) : (
                                "Refuser"
                            )}
                        </PillButtonUI>
                    )}
                    {onClose && (
                        <TextButtonUI size="xs" title="Fermer la proposition" onClick={onClose} className="ml-auto">
                            Fermer
                        </TextButtonUI>
                    )}
                    {onView && (
                        <PillButtonUI
                            tone="black"
                            size="xs"
                            onClick={onView}
                            disabled={controlsDisabled || resolved}
                            loading={busyAction === "view"}
                            title={
                                resolved
                                    ? "This change has been resolved and is no longer in the document."
                                    : undefined
                            }
                            className={onClose ? undefined : "ml-auto"}
                        >
                            Voir
                        </PillButtonUI>
                    )}
                </div>
            )}

            {statusMessage && (
                <p
                    className={`mt-2 text-xs ${statusMessageClassName}`}
                    role="status"
                >
                    {statusMessage}
                </p>
            )}
        </div>
    );
}
