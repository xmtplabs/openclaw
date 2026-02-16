import { html, nothing } from "lit";
import type { ConvosStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { renderChannelConfigSection } from "./channels.config.ts";

export function renderConvosCard(params: {
  props: ChannelsProps;
  convos?: ConvosStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, convos, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="card-title">Convos</div>
      <div class="card-sub">E2E encrypted messaging via XMTP.</div>
      ${accountCountLabel}

      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">Configured</span>
          <span>${convos?.configured ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Running</span>
          <span>${convos?.running ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Environment</span>
          <span>${convos?.env ?? "n/a"}</span>
        </div>
        <div>
          <span class="label">Last start</span>
          <span>${convos?.lastStartAt ? formatRelativeTimestamp(convos.lastStartAt) : "n/a"}</span>
        </div>
        <div>
          <span class="label">Last probe</span>
          <span>${convos?.lastProbeAt ? formatRelativeTimestamp(convos.lastProbeAt) : "n/a"}</span>
        </div>
      </div>

      ${
        convos?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${convos.lastError}
          </div>`
          : nothing
      }

      ${
        convos?.probe
          ? html`<div class="callout" style="margin-top: 12px;">
            Probe ${convos.probe.ok ? "ok" : "failed"} ${convos.probe.error ?? ""}
          </div>`
          : nothing
      }

      ${
        props.convosMessage
          ? html`<div class="callout" style="margin-top: 12px;">
            ${props.convosMessage}
          </div>`
          : nothing
      }

      ${
        props.convosJoined
          ? html`
              <div class="callout success" style="margin-top: 12px">
                <div style="text-align: center; padding: 12px">
                  <p style="font-weight: bold; color: #22c55e">Connected!</p>
                  <p style="margin-top: 8px; font-size: 0.85rem; color: #666">
                    You can now send and receive messages through Convos.
                  </p>
                </div>
              </div>
            `
          : props.convosInviteUrl
            ? html`<div class="callout" style="margin-top: 12px;">
              <div style="text-align: center; padding: 12px;">
                <p style="font-weight: bold; margin-bottom: 12px;">Scan with Convos App</p>
                ${
                  props.convosQrDataUrl
                    ? html`<div class="qr-wrap" style="margin-bottom: 12px;">
                      <img src=${props.convosQrDataUrl} alt="Convos Invite QR" />
                    </div>`
                    : nothing
                }
                <div style="margin-bottom: 12px;">
                  <input
                    type="text"
                    readonly
                    .value=${props.convosInviteUrl}
                    style="width: 100%; font-family: monospace; font-size: 0.85rem; padding: 8px; border: 1px solid #ccc; border-radius: 4px;"
                    @click=${(e: Event) => (e.target as HTMLInputElement).select()}
                  />
                </div>
                <div>
                  <a
                    href=${props.convosInviteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn"
                    style="display: inline-block; text-decoration: none;"
                  >
                    Open Invite Link
                  </a>
                </div>
                <p style="margin-top: 12px; font-size: 0.85rem; color: #666;">
                  Scan the QR code with the Convos iOS app, or copy the link and open it on your phone.
                </p>
              </div>
            </div>`
            : nothing
      }

      <div class="row" style="margin-top: 14px; flex-wrap: wrap;">
        <button
          class="btn primary"
          ?disabled=${props.convosBusy}
          @click=${() => props.onConvosSetup()}
        >
          ${props.convosBusy ? "Setting up..." : convos?.configured ? "Regenerate Invite" : "Generate Invite Link"}
        </button>
        <button class="btn" @click=${() => props.onRefresh(true)}>
          Probe
        </button>
        ${
          convos?.configured
            ? html`<button
              class="btn danger"
              ?disabled=${props.convosBusy}
              @click=${() => props.onConvosReset()}
            >
              Reset Integration
            </button>`
            : nothing
        }
      </div>

      ${renderChannelConfigSection({ channelId: "convos", props })}
    </div>
  `;
}
