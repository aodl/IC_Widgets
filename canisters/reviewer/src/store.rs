use std::{borrow::Cow, cell::RefCell};

use ic_stable_structures::{
    DefaultMemoryImpl, StableBTreeMap, StableCell, Storable,
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    storable::Bound,
};

use crate::model::{Job, Receipt, Sources};

type Memory = VirtualMemory<DefaultMemoryImpl>;
type ReceiptKey = (u64, u32);

#[derive(candid::CandidType, serde::Deserialize)]
pub struct Config {
    pub schema_version: u16,
    pub sources: Sources,
    pub active_job: Option<u64>,
    pub jobs_created: u64,
    pub raw_bytes: u64,
}

impl Config {
    fn empty() -> Self {
        Self {
            schema_version: 1,
            sources: Sources::canonical(),
            active_job: None,
            jobs_created: 0,
            raw_bytes: 0,
        }
    }
}

// Version 1 uses fixed memory IDs 0=config, 1=jobs, 2=receipts, 3=raw replies.
thread_local! {
    static MEMORY: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static CONFIG: RefCell<StableCell<Config, Memory>> =
        RefCell::new(StableCell::init(memory(0), Config::empty()));
    static JOBS: RefCell<StableBTreeMap<u64, Job, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(1)));
    static RECEIPTS: RefCell<StableBTreeMap<ReceiptKey, Receipt, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(2)));
    static RAW: RefCell<StableBTreeMap<ReceiptKey, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(3)));
}

fn memory(id: u8) -> Memory {
    MEMORY.with_borrow(|manager| manager.get(MemoryId::new(id)))
}

pub fn config() -> Config {
    CONFIG.with_borrow(|cell| {
        let config = cell.get();
        Config {
            schema_version: config.schema_version,
            sources: config.sources,
            active_job: config.active_job,
            jobs_created: config.jobs_created,
            raw_bytes: config.raw_bytes,
        }
    })
}

pub fn put_config(config: Config) {
    CONFIG.with_borrow_mut(|cell| {
        cell.set(config);
    });
}

pub fn job(id: u64) -> Option<Job> {
    JOBS.with_borrow(|jobs| jobs.get(&id))
}

pub fn put_job(job: Job) {
    JOBS.with_borrow_mut(|jobs| jobs.insert(job.id, job));
}

pub fn receipt(id: u64, index: u32) -> Option<Receipt> {
    RECEIPTS.with_borrow(|receipts| receipts.get(&(id, index)))
}

pub fn raw(id: u64, index: u32) -> Option<Vec<u8>> {
    RAW.with_borrow(|replies| replies.get(&(id, index)))
}

pub fn put_receipt(receipt: Receipt, raw_bytes: Option<Vec<u8>>) {
    let key = (receipt.job_id, receipt.index);
    if let Some(bytes) = raw_bytes {
        RAW.with_borrow_mut(|replies| replies.insert(key, bytes));
    }
    RECEIPTS.with_borrow_mut(|receipts| receipts.insert(key, receipt));
}

macro_rules! stable_candid {
    ($($type:ty),+) => {$(
        impl Storable for $type {
            fn to_bytes(&self) -> Cow<'_, [u8]> {
                Cow::Owned(self.into_bytes_by_ref())
            }
            fn into_bytes(self) -> Vec<u8> {
                self.into_bytes_by_ref()
            }
            fn from_bytes(bytes: Cow<'_, [u8]>) -> Self {
                candid::decode_one(&bytes).expect("decode stable schema v1")
            }
            const BOUND: Bound = Bound::Unbounded;
        }
        impl $type {
            fn into_bytes_by_ref(&self) -> Vec<u8> {
                candid::encode_one(self).expect("encode stable schema v1")
            }
        }
    )+};
}

stable_candid!(Config, Job, Receipt);
