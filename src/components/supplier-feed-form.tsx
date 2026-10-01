"use client";

import { useActionState, useState } from "react";
import { saveSupplierFeedAction, syncSupplierFeedAction } from "@/actions/stock-actions";
import { Field, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { initialActionState } from "@/lib/format";
import type { SupplierFieldMapping } from "@/lib/supplier-connector";

type FeedType = "JSON" | "XML" | "CSV_URL" | "MANUAL_CSV";
type AuthType = "NONE" | "BEARER" | "API_KEY_HEADER" | "BASIC";

export function SupplierFeedForm({
  supplierId,
  markupPercent,
  stockFeedUrl,
  hasKey,
  feedType,
  authType,
  authHeaderName,
  authUsername,
  vatMode,
  stockSyncIntervalMinutes,
  priceSyncIntervalMinutes,
  catalogueSyncIntervalMinutes,
  preference,
  leadTimeDays,
  mapping,
}: {
  supplierId: string;
  markupPercent: number;
  stockFeedUrl: string;
  hasKey: boolean;
  feedType: FeedType;
  authType: AuthType;
  authHeaderName: string;
  authUsername: string;
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
  stockSyncIntervalMinutes: number;
  priceSyncIntervalMinutes: number;
  catalogueSyncIntervalMinutes: number;
  preference: number;
  leadTimeDays: number | null;
  mapping: SupplierFieldMapping;
}) {
  const [state, action, pending] = useActionState(saveSupplierFeedAction, initialActionState);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>();
  const [type, setType] = useState<FeedType>(feedType);
  const [auth, setAuth] = useState<AuthType>(authType);
  const manual = type === "MANUAL_CSV";
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 md:grid-cols-2">
        {state.error ? <p className="text-sm text-red-700 md:col-span-2">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-muted md:col-span-2">{state.success}</p> : null}
        <input type="hidden" name="supplierId" value={supplierId} />
        <Field label="Feed type" name="feedType">
          <select id="feedType" name="feedType" className={inputClass} value={type} onChange={(event) => setType(event.target.value as FeedType)}>
            <option value="JSON">JSON API or feed</option>
            <option value="XML">XML feed</option>
            <option value="CSV_URL">CSV feed URL</option>
            <option value="MANUAL_CSV">Manual CSV upload</option>
          </select>
        </Field>
        <Field label="Markup percent" name="markupPercent" error={state.fieldErrors?.markupPercent}>
          <input id="markupPercent" name="markupPercent" type="number" min={0} max={300} defaultValue={markupPercent} required className={inputClass} />
        </Field>
        {manual ? <input type="hidden" name="stockFeedUrl" value="" /> : (
          <Field label="Feed URL" name="stockFeedUrl" error={state.fieldErrors?.stockFeedUrl}>
            <input id="stockFeedUrl" name="stockFeedUrl" type="url" defaultValue={stockFeedUrl} placeholder="https://supplier.example/feed" className={inputClass} />
          </Field>
        )}
        <Field label="VAT" name="vatMode">
          <select id="vatMode" name="vatMode" className={inputClass} defaultValue={vatMode}>
            <option value="EXCLUSIVE">Exclusive</option>
            <option value="INCLUSIVE">Inclusive</option>
          </select>
        </Field>
        <Field label="Authentication" name="authType">
          <select id="authType" name="authType" className={inputClass} value={auth} onChange={(event) => setAuth(event.target.value as AuthType)}>
            <option value="NONE">None</option>
            <option value="BEARER">Bearer token</option>
            <option value="API_KEY_HEADER">API key header</option>
            <option value="BASIC">Basic</option>
          </select>
        </Field>
        {auth === "API_KEY_HEADER" ? (
          <Field label="API key header name" name="authHeaderName">
            <input id="authHeaderName" name="authHeaderName" defaultValue={authHeaderName || "X-Api-Key"} className={inputClass} />
          </Field>
        ) : <input type="hidden" name="authHeaderName" value={authHeaderName || "X-Api-Key"} />}
        {auth === "BASIC" ? (
          <Field label="Username" name="authUsername">
            <input id="authUsername" name="authUsername" defaultValue={authUsername} autoComplete="off" className={inputClass} />
          </Field>
        ) : <input type="hidden" name="authUsername" value={authUsername} />}
        {auth === "BEARER" || auth === "API_KEY_HEADER" ? (
          <Field label={auth === "BEARER" ? "Bearer token" : "API key"} name="stockFeedKey">
            <input id="stockFeedKey" name="stockFeedKey" type="password" autoComplete="off" placeholder={hasKey ? "Saved. Enter a new value to replace it." : ""} className={inputClass} />
          </Field>
        ) : <input type="hidden" name="stockFeedKey" value="" />}
        {auth === "BASIC" ? (
          <Field label="Password" name="authPassword">
            <input id="authPassword" name="authPassword" type="password" autoComplete="off" placeholder={hasKey ? "Saved. Enter a new password to replace it." : ""} className={inputClass} />
          </Field>
        ) : <input type="hidden" name="authPassword" value="" />}
        <Field label="Stock sync interval (minutes)" name="stockSyncIntervalMinutes">
          <input id="stockSyncIntervalMinutes" name="stockSyncIntervalMinutes" type="number" min={60} max={10080} defaultValue={stockSyncIntervalMinutes} required className={inputClass} />
        </Field>
        <Field label="Price sync interval (minutes)" name="priceSyncIntervalMinutes">
          <input id="priceSyncIntervalMinutes" name="priceSyncIntervalMinutes" type="number" min={60} max={10080} defaultValue={priceSyncIntervalMinutes} required className={inputClass} />
        </Field>
        <Field label="Catalogue sync interval (minutes)" name="catalogueSyncIntervalMinutes">
          <input id="catalogueSyncIntervalMinutes" name="catalogueSyncIntervalMinutes" type="number" min={60} max={10080} defaultValue={catalogueSyncIntervalMinutes} required className={inputClass} />
        </Field>
        <Field label="Preference" name="preference">
          <input id="preference" name="preference" type="number" min={0} max={100} defaultValue={preference} required className={inputClass} />
        </Field>
        <Field label="Lead time (days)" name="leadTimeDays">
          <input id="leadTimeDays" name="leadTimeDays" type="number" min={0} max={365} defaultValue={leadTimeDays ?? ""} className={inputClass} />
        </Field>
        <details className="md:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">Field mapping</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="XML product element" name="productElement">
              <input id="productElement" name="productElement" defaultValue={mapping.productElement ?? ""} placeholder="product" className={inputClass} />
            </Field>
            <MapField id="mapSku" name="mapSku" label="SKU field" value={mapping.sku} />
            <MapField id="mapMpn" name="mapMpn" label="Manufacturer part number field" value={mapping.manufacturerPartNumber} />
            <MapField id="mapName" name="mapName" label="Name field" value={mapping.name} />
            <MapField id="mapBrand" name="mapBrand" label="Brand field" value={mapping.brand} />
            <MapField id="mapCost" name="mapCost" label="Cost field" value={mapping.cost} />
            <MapField id="mapStock" name="mapStock" label="Stock field" value={mapping.stock} />
            <MapField id="mapDescription" name="mapDescription" label="Description field" value={mapping.description} />
            <MapField id="mapSpecifications" name="mapSpecifications" label="Specifications field" value={mapping.specifications} />
            <MapField id="mapImages" name="mapImages" label="Image field" value={mapping.imageUrls} />
            <MapField id="mapCategory" name="mapCategory" label="Category field" value={mapping.category} />
            <MapField id="mapLeadTime" name="mapLeadTime" label="Lead time field" value={mapping.leadTimeDays} />
          </div>
        </details>
        <div className="md:col-span-2">
          <button className={buttonSecondary} disabled={pending}>{pending ? "Saving..." : "Save feed"}</button>
        </div>
      </form>
      {manual ? null : (
        <button
          type="button"
          className={buttonPrimary}
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            void syncSupplierFeedAction(supplierId).then((result) => {
              setSyncMessage(result.error ?? result.success);
              setSyncing(false);
            });
          }}
        >
          {syncing ? "Syncing..." : "Sync stock now"}
        </button>
      )}
      {syncMessage ? <p className="text-sm text-muted">{syncMessage}</p> : null}
      <p className="text-sm text-muted">JSON can be a list, or an object with items or products. XML uses the product element you name, or product, item, or offer. A CSV address is downloaded on sync. Leave the mapping blank to use those common field names. The hourly sync skips a supplier until a feed address is saved, and it waits for each interval. A manual CSV is uploaded below and does not change the catalogue sell price. VAT inclusive costs are stored exclusive of 15% VAT. A sell price is taken only from a fresh offer that has stock and a cost, and a move of 15% or more waits for approval.</p>
    </div>
  );
}

function MapField({ id, name, label, value }: { id: string; name: string; label: string; value?: string }) {
  return (
    <Field label={label} name={name}>
      <input id={id} name={name} defaultValue={value ?? ""} className={inputClass} />
    </Field>
  );
}
