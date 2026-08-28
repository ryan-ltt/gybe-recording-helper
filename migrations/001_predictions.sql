-- predictions: gliffcoin markets on upcoming setlists
-- balances and payouts are server-authoritative (service role only).

create table if not exists pred_balances (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    balance    numeric(12,2) not null default 100,
    updated_at timestamptz   not null default now()
);

create table if not exists pred_markets (
    id               bigserial primary key,
    show_date        text        not null,
    kind             text        not null check (kind in ('slot','closer','rare','bustout','debut')),
    slot             int,
    subject          text,
    outcomes         jsonb       not null,
    prior            jsonb       not null,
    seed             numeric(12,2) not null default 10,
    status           text        not null default 'open' check (status in ('open','locked','resolved','void')),
    resolved_outcome text,
    created_at       timestamptz not null default now(),
    resolved_at      timestamptz
);

create unique index if not exists pred_markets_ident
    on pred_markets (show_date, kind, coalesce(slot, -1), coalesce(subject, ''));
create index if not exists pred_markets_open on pred_markets (status, show_date);

create table if not exists pred_bets (
    id           bigserial primary key,
    user_id      uuid   not null references auth.users(id) on delete cascade,
    market_id    bigint not null references pred_markets(id) on delete cascade,
    outcome      text   not null,
    stake        numeric(12,2) not null check (stake > 0),
    prior_at_bet numeric(8,6),
    created_at   timestamptz not null default now()
);

create index if not exists pred_bets_market on pred_bets (market_id);
create index if not exists pred_bets_user   on pred_bets (user_id);

-- ledger: every balance change. makes resolution idempotent across reruns.
create table if not exists pred_ledger (
    id         bigserial primary key,
    user_id    uuid   not null references auth.users(id) on delete cascade,
    market_id  bigint references pred_markets(id) on delete set null,
    delta      numeric(12,2) not null,
    reason     text   not null check (reason in ('seed','bet','payout','refund','topup')),
    created_at timestamptz not null default now()
);

create unique index if not exists pred_ledger_once
    on pred_ledger (user_id, market_id, reason)
    where reason in ('payout','refund');

alter table pred_balances enable row level security;
alter table pred_markets  enable row level security;
alter table pred_bets     enable row level security;
alter table pred_ledger   enable row level security;

-- everyone reads the board; nobody writes balances from the client.
drop policy if exists pred_markets_read on pred_markets;
create policy pred_markets_read on pred_markets for select using (true);

drop policy if exists pred_bets_read on pred_bets;
create policy pred_bets_read on pred_bets for select using (true);

drop policy if exists pred_balances_read on pred_balances;
create policy pred_balances_read on pred_balances for select using (true);

drop policy if exists pred_ledger_read on pred_ledger;
create policy pred_ledger_read on pred_ledger for select using (auth.uid() = user_id);

-- no client insert/update/delete policies: writes go through place_bet() or the
-- service role. absence of a policy denies the operation under RLS.

-- atomic bet placement: checks balance, market state, and stake caps together.
create or replace function place_bet(p_market_id bigint, p_outcome text, p_stake numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user    uuid := auth.uid();
    v_market  pred_markets%rowtype;
    v_balance numeric(12,2);
    v_prior   numeric(8,6);
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
    -- would serialise every bet on a popular market and can deadlock against the
    -- sync job's status updates, which take the same rows in the other order.
    select * into v_market from pred_markets where id = p_market_id;
    if not found then
        return json_build_object('ok', false, 'error', 'no such market');
    end if;
    if v_market.status <> 'open' then
        return json_build_object('ok', false, 'error', 'market is ' || v_market.status);
    end if;

    -- a setlist reaches the site the morning after the show, so a market whose
    -- date has arrived is bettable by anyone who already knows the answer.
    -- the daily sync also locks these, but it cannot be the only guard.
    if v_market.show_date <= to_char(now() at time zone 'utc', 'YYYY-MM-DD') then
        return json_build_object('ok', false, 'error', 'betting closed for this show');
    end if;
    if not (v_market.outcomes ? p_outcome) then
        return json_build_object('ok', false, 'error', 'not a valid outcome');
    end if;

    v_prior := coalesce((v_market.prior ->> p_outcome)::numeric, 0);

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

    update pred_balances
       set balance = balance - p_stake, updated_at = now()
     where user_id = v_user;

    insert into pred_bets (user_id, market_id, outcome, stake, prior_at_bet)
        values (v_user, p_market_id, p_outcome, p_stake, v_prior);

    insert into pred_ledger (user_id, market_id, delta, reason)
        values (v_user, p_market_id, -p_stake, 'bet');

    return json_build_object('ok', true, 'balance', v_balance - p_stake);
end;
$$;

revoke all on function place_bet(bigint, text, numeric) from public;
grant execute on function place_bet(bigint, text, numeric) to authenticated;

-- signing up gets you a starting balance of 100 gliffcoins.
create or replace function ensure_balance()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bal  numeric(12,2);
begin
    if v_user is null then
        return null;
    end if;
    insert into pred_balances (user_id) values (v_user)
        on conflict (user_id) do nothing;
    select balance into v_bal from pred_balances where user_id = v_user;
    return v_bal;
end;
$$;

revoke all on function ensure_balance() from public;
grant execute on function ensure_balance() to authenticated;

-- payouts. service role only: never granted to authenticated or anon.
--
-- the ledger row and the balance move together in one transaction: writing the
-- ledger first and crediting second leaves a window where a failed credit looks
-- like an already-paid market on the next run, and the winnings vanish.
-- returns false when the ledger already had this payout, so a rerun is a no-op.
create or replace function settle_payout(
    p_user uuid, p_market bigint, p_amount numeric, p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_reason not in ('payout', 'refund') then
        raise exception 'settle_payout: bad reason %', p_reason;
    end if;

    begin
        insert into pred_ledger (user_id, market_id, delta, reason)
            values (p_user, p_market, p_amount, p_reason);
    exception when unique_violation then
        return false;   -- already settled on an earlier run
    end;

    insert into pred_balances (user_id, balance)
        values (p_user, 100 + p_amount)
    on conflict (user_id) do update
        set balance = pred_balances.balance + p_amount,
            updated_at = now();

    return true;
end;
$$;

revoke all on function settle_payout(uuid, bigint, numeric, text) from public;
revoke all on function settle_payout(uuid, bigint, numeric, text) from authenticated;
revoke all on function settle_payout(uuid, bigint, numeric, text) from anon;
