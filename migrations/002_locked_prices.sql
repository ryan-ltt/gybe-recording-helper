-- predictions: lock the price the bettor was shown, not the market's prior.
--
-- before this, place_bet stored the market's opening prior as prior_at_bet while
-- the page showed a price blended with the betting pool, so most bets were paid
-- at odds nobody had seen. now the page sends the price it quoted for the stake
-- being placed, place_bet recomputes it, and the bet is refused if the two
-- differ (someone else's bet landed in between). bets already placed keep the
-- prior_at_bet they were stored with: settlement reads only that column.
--
-- apply this BEFORE deploying the matching predictions.js. the new page passes
-- p_price, which the old function does not accept. pages still cached from
-- before keep working against this one: p_price is optional, and without it
-- the bet locks the server's quote.

-- the price a bet of p_stake on p_outcome locks: predQuote() in predictions.js.
-- the stake is part of the book it is priced against; quoting the book without
-- it lets a bettor move a price with one bet and take the other side of it at
-- the inflated odds with the next. keep 200 (PRED_POOL_K) and 0.001
-- (PRED_FLOOR) in step with predictions.js.
create or replace function pred_quote(p_market pred_markets, p_outcome text, p_stake numeric)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
    v_total numeric;
    v_w     numeric;
    v_sum   numeric := 0;
    v_mine  numeric;
    v_pool  numeric;
    v_p     numeric;
    r       record;
begin
    select coalesce(sum(stake), 0) + p_stake into v_total
      from pred_bets where market_id = p_market.id;
    v_w := case when v_total > 0 then v_total / (v_total + 200) else 0 end;

    for r in select key, value::numeric as prior from jsonb_each_text(p_market.prior) loop
        select coalesce(sum(stake), 0) into v_pool
          from pred_bets where market_id = p_market.id and outcome = r.key;
        if r.key = p_outcome then
            v_pool := v_pool + p_stake;
        end if;
        v_p := greatest(
            (1 - v_w) * r.prior
              + v_w * (case when v_total > 0 then v_pool / v_total else 0 end),
            0.001);
        v_sum := v_sum + v_p;
        if r.key = p_outcome then
            v_mine := v_p;
        end if;
    end loop;

    if v_mine is null or v_sum = 0 then
        return null;
    end if;
    return v_mine / v_sum;
end;
$$;

revoke all on function pred_quote(pred_markets, text, numeric) from public;

-- the signature changes, so the old three-argument version has to go: leaving it
-- would make a three-argument call ambiguous between the two.
drop function if exists place_bet(bigint, text, numeric);

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

    -- a setlist reaches the site the morning after the show, so a market whose
    -- date has arrived is bettable by anyone who already knows the answer.
    -- the daily sync also locks these, but it cannot be the only guard.
    if v_market.show_date <= to_char(now() at time zone 'utc', 'YYYY-MM-DD') then
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

revoke all on function place_bet(bigint, text, numeric, numeric) from public;
grant execute on function place_bet(bigint, text, numeric, numeric) to authenticated;
