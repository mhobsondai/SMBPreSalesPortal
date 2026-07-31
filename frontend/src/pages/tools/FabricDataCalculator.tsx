import { useMemo, useState } from 'react';

import { TopBar } from '../../components/TopBar';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { resolvePath } from '../../config/navigation';
import { APP_VERSION } from '../../config/app';
import {
  DEFAULT_HOURS_PER_DAY,
  FABRIC_MODEL
} from '../../config/fabricEstimatorModel';
import {
  calculateEstimate,
  categoryBarPercents,
  formatNumber,
  normaliseQuantity,
  summaryLines,
  type Quantities
} from '../../lib/estimating/fabricEstimator';
import '../../styles/tool.css';
import './FabricDataCalculator.css';

type Tab = 'estimate' | 'rates';

/**
 * Microsoft Fabric Data Calculator.
 *
 * Enter quantities, get delivery days and hours from the day-factor
 * model. Runs entirely in the browser — nothing entered here is uploaded
 * or stored, and quantities are lost on refresh by design.
 *
 * Output is intended to feed the Fabric Quote Generator, so the summary
 * is plain text and copyable rather than a rendered table.
 */
export function FabricDataCalculator() {
  const [tab, setTab] = useState<Tab>('estimate');
  const [quantities, setQuantities] = useState<Quantities>({});
  const [hoursPerDayRaw, setHoursPerDayRaw] = useState(String(DEFAULT_HOURS_PER_DAY));
  const [copied, setCopied] = useState(false);

  const trail = resolvePath(['data-ai'])?.trail ?? [];
  const hoursPerDay = normaliseQuantity(hoursPerDayRaw);

  const result = useMemo(
    () => calculateEstimate(quantities, hoursPerDay),
    [quantities, hoursPerDay]
  );
  const barPercents = useMemo(() => categoryBarPercents(result), [result]);
  const summary = useMemo(
    () => summaryLines(result, hoursPerDay),
    [result, hoursPerDay]
  );

  function setQuantity(id: string, raw: string) {
    setQuantities((prev) => ({ ...prev, [id]: normaliseQuantity(raw) }));
  }

  function reset() {
    setQuantities({});
    setHoursPerDayRaw(String(DEFAULT_HOURS_PER_DAY));
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const totalItems = FABRIC_MODEL.reduce((n, c) => n + c.items.length, 0);

  return (
    <>
      <TopBar
        links={[{ label: 'Data & AI', to: '/area/data-ai' }, { label: 'All areas', to: '/' }]}
      />

      <main className="page">
        <Breadcrumbs trail={trail} tail="Data Calculator" />

        <section className="tool-header reveal reveal-1">
          <div>
            <div className="eyebrow">Fabric Platform</div>
            <h1 className="display">
              Data <em>Calculator</em>
            </h1>
            <p className="lede">
              Enter quantities against the day-factor model to produce an
              estimated delivery effort in days and hours, ready for the quote.
            </p>
          </div>
          <div className="tool-header-meta">
            <div><strong>{totalItems}</strong> line items</div>
            <div><strong>{FABRIC_MODEL.length}</strong> categories</div>
            <div><strong>{APP_VERSION}</strong></div>
          </div>
        </section>

        <div className="tool-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'estimate'}
            className={`tool-tab ${tab === 'estimate' ? 'is-active' : ''}`}
            onClick={() => setTab('estimate')}
          >
            Estimator
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rates'}
            className={`tool-tab ${tab === 'rates' ? 'is-active' : ''}`}
            onClick={() => setTab('rates')}
          >
            Rate card
          </button>
        </div>

        {tab === 'estimate' ? (
          <>
            <div className="panel settings-panel">
              <label htmlFor="hpd">Working hours per day</label>
              <input
                id="hpd"
                type="number"
                min="0"
                step="0.5"
                value={hoursPerDayRaw}
                onChange={(e) => setHoursPerDayRaw(e.target.value)}
                className="setting-input"
              />
              <button type="button" className="btn-ghost reset-btn" onClick={reset}>
                Reset
              </button>
            </div>

            {result.categories.map((group) => (
              <div className="cat" key={group.category.id}>
                <div className="cat-head">
                  <span className="cat-dot" aria-hidden="true" />
                  <span className="cat-title">{group.category.category}</span>
                  <span className="cat-sub">
                    {group.category.items.length} item
                    {group.category.items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="cat-body">
                  <div className="est-row est-row--head" aria-hidden="true">
                    <span>Item</span>
                    <span>Day factor</span>
                    <span>Quantity</span>
                    <span className="r">Days</span>
                    <span className="r r-hours">Hours</span>
                  </div>

                  {group.lines.map((line) => (
                    <div className="est-row" key={line.item.id}>
                      <span className="item-name">{line.item.name}</span>
                      <span className="factor-chip">× {line.item.factor}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="num-input"
                        value={quantities[line.item.id] || ''}
                        placeholder="0"
                        aria-label={`Quantity — ${group.category.category} ${line.item.name}`}
                        onChange={(e) => setQuantity(line.item.id, e.target.value)}
                      />
                      <span className={`cell-days${line.days ? '' : ' cell-zero'}`}>
                        {formatNumber(line.days)}
                      </span>
                      <span className={`cell-hours r-hours${line.hours ? '' : ' cell-zero'}`}>
                        {formatNumber(line.hours)}
                      </span>
                    </div>
                  ))}

                  <div className="est-row est-row--subtotal">
                    <span className="subtotal-label">
                      {group.category.category} subtotal
                    </span>
                    <span className={`cell-days${group.days ? '' : ' cell-zero'}`}>
                      {formatNumber(group.days)}
                    </span>
                    <span className={`cell-hours r-hours${group.days ? '' : ' cell-zero'}`}>
                      {formatNumber(group.hours)}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            <div className="panel totals-panel">
              <div className="totals-grid">
                <div className="total-box total-box--days">
                  <div className="total-num">{formatNumber(result.totalDays)}</div>
                  <div className="total-lbl">Total days</div>
                  <div className="total-note">Σ (factor × quantity)</div>
                </div>
                <div className="total-box total-box--hours">
                  <div className="total-num">{formatNumber(result.totalHours)}</div>
                  <div className="total-lbl">Total hours</div>
                  <div className="total-note">days × {formatNumber(hoursPerDay)}</div>
                </div>
              </div>

              <div className="breakdown">
                {result.categories.map((group, i) => (
                  <div className="bd-row" key={group.category.id}>
                    <div className="bd-label">{group.category.category}</div>
                    <div className="bd-track">
                      <div className="bd-fill" style={{ width: `${barPercents[i]}%` }} />
                    </div>
                    <div className="bd-val">{formatNumber(group.days)} d</div>
                  </div>
                ))}
              </div>
              <p className="bd-note">
                Bars compare categories against the largest, not against the
                total.
              </p>
            </div>

            <div className="panel output-panel">
              <div className="panel-head">
                <h3 className="panel-title">Estimate summary</h3>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={copySummary}
                  disabled={result.isEmpty}
                >
                  {copied ? 'Copied' : 'Copy all'}
                </button>
              </div>
              <p className="panel-note">
                Paste into the quote, or hand to the Fabric Quote Generator.
              </p>
              <pre className="output-block">
                {result.isEmpty ? (
                  <span className="output-empty">
                    Enter quantities above to build an estimate…
                  </span>
                ) : (
                  summary.join('\n')
                )}
              </pre>
            </div>
          </>
        ) : (
          <RateCard />
        )}
      </main>

      <footer className="page-footer">
        SMB Pre-Sales Portal · {APP_VERSION} · Codestone internal use only
      </footer>
    </>
  );
}

function RateCard() {
  return (
    <>
      <div className="panel">
        <h3 className="panel-title">Day-factor rate card</h3>
        <p className="panel-note">
          Each line item carries a fixed day factor. Estimated days = factor ×
          quantity. Hours = days × the working-hours-per-day setting, which
          defaults to {DEFAULT_HOURS_PER_DAY}.
        </p>

        <table className="rate-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Item</th>
              <th className="r">Day factor</th>
            </tr>
          </thead>
          <tbody>
            {FABRIC_MODEL.map((category) =>
              category.items.map((item, i) => (
                <tr key={item.id}>
                  <td className="rate-cat">{i === 0 ? category.category : ''}</td>
                  <td>{item.name}</td>
                  <td className="r rate-factor">× {item.factor}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="panel-note">
        Factors mirror the source estimating spreadsheet. They feed quotes, so
        changing one is a pricing decision — edit{' '}
        <code>config/fabricEstimatorModel.ts</code> and update the pinned test
        fixture in the same commit.
      </p>
    </>
  );
}
