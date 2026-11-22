use candid::CandidType;
use serde::Deserialize;

pub const FLOOR: u128 = 50_000_000_000;
pub const CALL_TIMEOUT: u32 = 30;
pub const LEASE: u64 = 90_000_000_000;
pub const SECOND: u64 = 1_000_000_000;
pub const REPLY_BYTES: u64 = nexus_ic_sources::MAX_RESPONSE_BYTES as u64;
// Account separately for dispatch, local slices, scheduling and storage writes.
// Operational allowance. The IC prices ongoing storage independently of jobs.
const SLICE_ALLOWANCE: u128 = 250_000_000;

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub struct Limits {
    pub cycle_ceiling: u128,
    pub calls: u32,
    pub attempts: u8,
    pub raw_bytes: u64,
    pub slices: u32,
    pub duration_secs: u32,
}

impl Limits {
    pub const PROBE: Self = Self {
        cycle_ceiling: 4_000_000_000_000,
        calls: 64,
        attempts: 2,
        raw_bytes: 32 * 1024 * 1024,
        slices: 64,
        duration_secs: 900,
    };

    pub fn validate(self, max: Self) -> Result<(), String> {
        if self.cycle_ceiling == 0
            || self.cycle_ceiling > max.cycle_ceiling
            || self.calls == 0
            || self.calls > max.calls
            || self.attempts == 0
            || self.attempts > max.attempts
            || self.raw_bytes < REPLY_BYTES
            || self.raw_bytes > max.raw_bytes
            || self.slices == 0
            || self.slices > max.slices
            || self.duration_secs == 0
            || self.duration_secs > max.duration_secs
        {
            Err("limits outside supported operational bounds".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize, PartialEq, Eq)]
pub enum Stop {
    Completed,
    CycleBalance,
    CycleCeiling,
    CallLimit,
    RawByteLimit,
    SliceLimit,
    Deadline,
    AttemptLimit,
    StorageLimit,
}

#[derive(Clone, Copy, Debug, CandidType, Deserialize)]
pub struct Usage {
    pub limits: Limits,
    pub started_at: u64,
    pub initial_balance: u128,
    pub observed_balance_decrease: u128,
    pub cycles_reserved: u128,
    pub calls: u32,
    pub raw_bytes: u64,
    pub slices: u32,
    pub measured_instructions: u64,
    pub stop: Option<Stop>,
}

impl Usage {
    pub fn new(limits: Limits, started_at: u64, initial_balance: u128) -> Self {
        Self {
            limits,
            started_at,
            initial_balance,
            observed_balance_decrease: 0,
            cycles_reserved: 0,
            calls: 0,
            raw_bytes: 0,
            slices: 0,
            measured_instructions: 0,
            stop: None,
        }
    }

    pub fn observe_balance(&mut self, balance: u128) {
        self.observed_balance_decrease = self
            .observed_balance_decrease
            .max(self.initial_balance.saturating_sub(balance));
    }

    /// A call reserves the system's worst response and callback price plus
    /// local overhead. Reservations remain charged to this job after refunds.
    pub fn admit(
        &mut self,
        now: u64,
        balance: u128,
        call_reservation: Option<u128>,
    ) -> Result<(), Stop> {
        self.observe_balance(balance);
        let charge = call_reservation
            .unwrap_or(0)
            .saturating_add(SLICE_ALLOWANCE);
        if now
            >= self
                .started_at
                .saturating_add(u64::from(self.limits.duration_secs) * SECOND)
        {
            return Err(Stop::Deadline);
        }
        if balance < FLOOR.saturating_add(charge) {
            return Err(Stop::CycleBalance);
        }
        if self
            .cycles_reserved
            .max(self.observed_balance_decrease)
            .saturating_add(charge)
            > self.limits.cycle_ceiling
        {
            return Err(Stop::CycleCeiling);
        }
        if self.slices >= self.limits.slices {
            return Err(Stop::SliceLimit);
        }
        if call_reservation.is_some() {
            if self.calls >= self.limits.calls {
                return Err(Stop::CallLimit);
            }
            if self.raw_bytes.saturating_add(REPLY_BYTES) > self.limits.raw_bytes {
                return Err(Stop::RawByteLimit);
            }
            self.calls += 1;
        }
        self.cycles_reserved += charge;
        self.slices += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reservations_and_observed_deltas_are_conservative() {
        let mut ledger = Usage::new(
            Limits {
                cycle_ceiling: 900_000_000,
                ..Limits::PROBE
            },
            0,
            FLOOR * 2,
        );
        ledger.admit(0, FLOOR * 2, Some(200_000_000)).unwrap();
        ledger.observe_balance(FLOOR * 2 - 600_000_000);
        assert_eq!(
            ledger.admit(1, FLOOR * 2, Some(200_000_000)),
            Err(Stop::CycleCeiling)
        );
        assert_eq!(ledger.calls, 1);
        assert_eq!(
            ledger.admit(901 * SECOND, FLOOR * 2, None),
            Err(Stop::Deadline)
        );
    }
}
