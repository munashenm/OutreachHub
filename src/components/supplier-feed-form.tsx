"use client";

import { useActionState, useState } from "react";
import { saveSupplierFeedAction, syncSupplierFeedAction, testSupplierFeedAction } from "@/actions/stock-actions";
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
  mode = "feed",
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
  mode?: "feed" | "settings";
}) {
  const [state, action, pending] = useActionState(saveSupplierFeedAction, initialActionState);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>();
  const [type, setType] = useState<FeedType>(feedType);
  const [auth, setAuth] = useState<AuthType>(authType);
  const [testing, setTesting] = useState(false);
  const manual = type === "MANUAL_CSV";
  const settings = mode === "settings";
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 md:grid-cols-2">
        {state.error ? <p className="text-sm text-red-700 md:col-span-2">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-muted md:col-span-2">{state.success}</p> : null}
        <input type="hidden" name="supplierId" value={supplierId} />
        {settings ? (
          <>
            <input type="hidden" name="feedType" value={type} />
            <input type="hidden" name="stockFeedUrl" value={manual ? "" : stockFeedUrl} />
            <input type="hidden" name="authType" value={auth} />
            <input type="hidden" name="authHeaderName" value={authHeaderName || "X-Api-Key"} />
            <input type="hidden" name="authUsername" value={authUsername} />
            <input type="hidden" name="stockFeedKey" value="" />
            <input type="hidden" name="authPassword" value="" />
            <input type="hidden" name="productElement" value={mapping.productElement ?? ""} />
            <input type="hidden" name="mapSku" value={mapping.sku ?? ""} />
            <input type="hidden" name="mapMpn" value={mapping.manufacturerPartNumber ?? ""} />
            <input type="hidden" name="mapName" value={mapping.name ?? ""} />
            <input type="hidden" name="mapBrand" value={mapping.brand ?? ""} />
            <input type="hidden" name="mapCost" value={mapping.cost ?? ""} />
            <input type="hidden" name="mapStock" value={mapping.stock ?? ""} />
            <input type="hidden" name="mapDescription" value={mapping.description ?? ""} />
            <input type="hidden" name="mapSpecifications" value={mapping.specifications ?? ""} />
            <input type="hidden" name="mapImages" value={mapping.imageUrls ?? ""} />
            <input type="hidden" name="mapCategory" value={mapping.category ?? ""} />
            <input type="hidden" name="mapLeadTime" value={mapping.leadTimeDays ?? ""} />
            <input type="hidden" name="mapBarcode" value={mapping.barcode ?? ""} />
            <input type="hidden" name="mapProductUrl" value={mapping.productUrl ?? ""} />
            <input type="hidden" name="mapCostIncl" value={mapping.costInclusive ?? ""} />
          </>
        ) : (
          <>
            <input type="hidden" name="markupPercent" value={markupPercent} />
            <input type="hidden" name="vatMode" value={vatMode} />
            <input type="hidden" name="stockSyncIntervalMinutes" value={stockSyncIntervalMinutes} />
            <input type="hidden" name="priceSyncIntervalMinutes" value={priceSyncIntervalMinutes} />
            <input type="hidden" name="catalogueSyncIntervalMinutes" value={catalogueSyncIntervalMinutes} />
            <input type="hidden" name="preference" value={preference} />
            <input type="hidden" name="leadTimeDays" value={leadTimeDays ?? ""} />
          </>
        )}
        {settings ? (
          <>
            <Field label="Markup percent" name="markupPercent" error={state.fieldErrors?.markupPercent}>
              <input id="markupPercent" name="markupPercent" type="number" min={0} max={300} defaultValue={markupPercent} required className={inputClass} />
            </Field>
            <Field label="VAT" name="vatMode">
              <select id="vatMode" name="vatMode" className={inputClass} defaultValue={vatMode}>
                <option value="EXCLUSIVE">Cost excludes VAT</option>
                <option value="INCLUSIVE">Cost includes VAT</option>
              </select>
            </Field>
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
          </>
        ) : (
          <>
            <Field label="Format" name="feedType">
              <select id="feedType" name="feedType" className={inputClass} value={type} onChange={(event) => setType(event.target.value as FeedType)}>
                <option value="JSON">JSON URL or API</option>
                <option value="XML">XML URL</option>
                <option value="CSV_URL">CSV URL</option>
                {feedType === "MANUAL_CSV" ? <option value="MANUAL_CSV">Manual file</option> : null}
              </select>
            </Field>
            {manual ? <input type="hidden" name="stockFeedUrl" value="" /> : (
              <Field label="Feed URL" name="stockFeedUrl" error={state.fieldErrors?.stockFeedUrl}>
                <input id="stockFeedUrl" name="stockFeedUrl" type="url" defaultValue={stockFeedUrl} placeholder="https://supplier.example/feed" className={inputClass} />
              </Field>
            )}
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
            <details className="md:col-span-2" open>
              <summary className="cursor-pointer text-sm font-medium">Column mapping</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="XML product element" name="productElement">
                  <input id="productElement" name="productElement" defaultValue={mapping.productElement ?? ""} placeholder="product" className={inputClass} />
                </Field>
                <MapField id="mapSku" name="mapSku" label="Supplier SKU" value={mapping.sku} />
                <MapField id="mapName" name="mapName" label="Product name" value={mapping.name} />
                <MapField id="mapBrand" name="mapBrand" label="Brand" value={mapping.brand} />
                <MapField id="mapMpn" name="mapMpn" label="Manufacturer part number" value={mapping.manufacturerPartNumber} />
                <MapField id="mapBarcode" name="mapBarcode" label="Barcode / EAN" value={mapping.barcode} />
                <MapField id="mapCategory" name="mapCategory" label="Category" value={mapping.category} />
                <MapField id="mapCost" name="mapCost" label="Cost excl VAT" value={mapping.cost} />
                <MapField id="mapCostIncl" name="mapCostIncl" label="Cost incl VAT" value={mapping.costInclusive} />
                <MapField id="mapStock" name="mapStock" label="Stock quantity" value={mapping.stock} />
                <MapField id="mapImages" name="mapImages" label="Image URL" value={mapping.imageUrls} />
                <MapField id="mapProductUrl" name="mapProductUrl" label="Product URL" value={mapping.productUrl} />
                <MapField id="mapLeadTime" name="mapLeadTime" label="Lead time" value={mapping.leadTimeDays} />
                <MapField id="mapDescription" name="mapDescription" label="Description" value={mapping.description} />
                <MapField id="mapSpecifications" name="mapSpecifications" label="Specifications" value={mapping.specifications} />
              </div>
            </details>
          </>
        )}
        <div className="md:col-span-2">
          <button className={buttonSecondary} disabled={pending}>{pending ? "Saving..." : settings ? "Save settings" : "Save feed"}</button>
        </div>
      </form>
      {settings || manual ? null : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonSecondary}
            disabled={testing}
            onClick={() => {
              setTesting(true);
              void testSupplierFeedAction(supplierId).then((result) => {
                setSyncMessage(result.error ?? result.success);
                setTesting(false);
              });
            }}
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
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
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      )}
      {syncMessage ? <p className="text-sm text-muted">{syncMessage}</p> : null}
      {settings ? (
        <p className="text-sm text-muted">These settings apply to this supplier. A cost that includes VAT is stored exclusive of 15% VAT. Catalogue prices and website publication stay on their existing rules.</p>
      ) : (
        <p className="text-sm text-muted">Use a JSON, CSV, or XML address, including an API endpoint. Authentication is optional. Leave the column mapping blank to use common field names. Test connection reads the feed and does not save it. A supplier that only uploads files does not need an address.</p>
      )}
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
