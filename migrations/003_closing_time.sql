-- predictions: close betting a few hours before the show, in the venue's time,
-- instead of at midnight UTC on the show date.
--
-- midnight UTC is the evening BEFORE the show anywhere in the americas (9pm the
-- night before in são paulo), so markets shut a day early there. each market
-- now carries closes_at: 18:00 local on show day, or 12:00 for festivals and
-- early shows (predClosesAt in predictions.js). sync-predictions.js sets it on
-- new markets and keeps it current on open ones.
--
-- a market with no closes_at keeps the old midnight-UTC rule, which is earlier
-- than 18:00 local everywhere: a missing value can close betting early, never
-- late.
--
-- apply this BEFORE deploying the matching predictions.js / sync-predictions.js:
-- the sync job writes closes_at, which needs the column. it is safe to apply on
-- its own: the backfill below only reopens markets whose show has not started.

alter table pred_markets add column if not exists closes_at timestamptz;

-- closing times for the shows open right now, so they apply at once rather than
-- after the next daily sync. computed with predClosesAt(); the sync job
-- overwrites them with the same values.
update pred_markets m
   set closes_at = v.closes_at
  from (values
    ('2026-11-24', timestamptz '2026-11-24T21:00:00Z'),  -- são paulo, 18:00 local
    ('2026-11-26', timestamptz '2026-11-26T15:00:00Z'),  -- santiago festival, 12:00 local
    ('2027-02-20', timestamptz '2027-02-20T23:00:00Z'),  -- québec
    ('2027-02-21', timestamptz '2027-02-21T23:00:00Z'),
    ('2027-02-22', timestamptz '2027-02-22T23:00:00Z'),  -- montréal
    ('2027-02-23', timestamptz '2027-02-23T23:00:00Z'),
    ('2027-02-24', timestamptz '2027-02-24T23:00:00Z'),
    ('2027-02-26', timestamptz '2027-02-26T23:00:00Z'),  -- toronto
    ('2027-02-27', timestamptz '2027-02-27T23:00:00Z'),
    ('2027-03-04', timestamptz '2027-03-04T22:00:00Z'),  -- san juan
    ('2027-03-05', timestamptz '2027-03-05T22:00:00Z')
  ) as v(show_date, closes_at)
 where m.show_date = v.show_date
   and m.status = 'open';

-- same signature as 002, so no drop: only the closing check changes.
create or replace function place_bet(
    p_market_id bigint, p_outcome text, p_stake numeric, p_price numeric default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user    uuid := auth.uid();
    v_market  pred_markets%rowtype;
    v_balance numeric(12,2);
    v_prior   numeric;
    v_price   numeric;
begin
    if v_user is null then
        return json_build_object('ok', false, 'error', 'not signed in');
    end if;

    if p_stake is null or p_stake <= 0 then
        return json_build_object('ok', false, 'error', 'stake must be positive');
    end if;
    if p_stake <> floor(p_stake) then
        return json_build_object('ok', false, 'error', 'bets must be whole gliffcoins');
    end if;

    -- read-only: place_bet never writes pred_markets, so no row lock here. one
    -- would deadlock against the sync job's status updates, which take the same
    -- rows in the other order.
    select * into v_market from pred_markets where id = p_market_id;
    if not found then
        return json_build_object('ok', false, 'error', 'no such market');
    end if;
    if v_market.status <> 'open' then
        return json_build_object('ok', false, 'error', 'market is ' || v_market.status);
    end if;

    -- setlists surface publicly the night of the show, so betting closes a few
    -- hours before it starts. the daily sync also locks closed markets, but it
    -- runs once a day and cannot be the only guard. no closes_at: midnight UTC
    -- on the show date, the old rule.
    if now() >= coalesce(v_market.closes_at,
                         (v_market.show_date || 'T00:00:00Z')::timestamptz) then
        return json_build_object('ok', false, 'error', 'betting closed for this show');
    end if;
    if not (v_market.outcomes ? p_outcome) then
        return json_build_object('ok', false, 'error', 'not a valid outcome');
    end if;

    -- the longshot cap goes by the model's prior, not the crowd-moved price:
    -- a crowd piling onto the other side shouldn't lift the cap on a 0.5% shot.
    v_prior := coalesce((v_market.prior ->> p_outcome)::numeric, 0);

    -- one bet at a time per market. each bet is priced against the book left by
    -- the one before it; two priced against the same book would each skip the
    -- other's move. this is an advisory lock, not a row lock, so it cannot meet
    -- the sync job's updates. it is always taken before the balance lock below,
    -- so two bets cannot wait on each other.
    perform pg_advisory_xact_lock(7342, p_market_id::int);

    insert into pred_balances (user_id) values (v_user)
        on conflict (user_id) do nothing;

    -- this lock is taken before the cap and balance checks, not after: it is the
    -- only thing serialising one user's concurrent bets, and both the running
    -- total below and the balance are read under it.
    select balance into v_balance from pred_balances where user_id = v_user for update;

    -- longshot stake cap: sub-1% outcomes are limited to 10 gliffcoins per user
    if v_prior < 0.01 then
        if p_stake + coalesce((
            select sum(stake) from pred_bets
            where market_id = p_market_id and user_id = v_user and outcome = p_outcome
        ), 0) > 10 then
            return json_build_object('ok', false, 'error', 'longshot cap: 10 gliffcoins per outcome');
        end if;
    end if;

    if v_balance < p_stake then
        return json_build_object('ok', false, 'error', 'not enough gliffcoins');
    end if;

    v_price := pred_quote(v_market, p_outcome, p_stake);
    if v_price is null or v_price <= 0 then
        return json_build_object('ok', false, 'error', 'could not price this outcome');
    end if;

    -- the bettor accepted p_price. if the book has moved since, they get to see
    -- the new price before committing to it. the tolerance only absorbs float
    -- noise between the page's arithmetic and this function's.
    if p_price is not null and abs(v_price - p_price) > 0.000001 then
        return json_build_object('ok', false, 'error', 'odds moved', 'price', v_price);
    end if;

    update pred_balances
       set balance = balance - p_stake, updated_at = now()
     where user_id = v_user;

    -- prior_at_bet is the price this bet is paid at, whatever the book does next.
    insert into pred_bets (user_id, market_id, outcome, stake, prior_at_bet)
        values (v_user, p_market_id, p_outcome, p_stake, round(v_price, 6));

    insert into pred_ledger (user_id, market_id, delta, reason)
        values (v_user, p_market_id, -p_stake, 'bet');

    return json_build_object('ok', true, 'balance', v_balance - p_stake,
                             'price', round(v_price, 6));
end;
$$;

-- create or replace keeps the existing grants; restated so this file stands alone.
revoke all on function place_bet(bigint, text, numeric, numeric) from public;
grant execute on function place_bet(bigint, text, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
