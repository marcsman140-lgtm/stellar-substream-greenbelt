#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub subscriber: Address,
    pub provider: Address,
    pub amount: i128,
    pub interval_sec: u64,
    pub last_payment: u64,
}

#[contracttype]
pub enum DataKey {
    Sub(u32), // Subscription ID
    Admin,
}

#[contract]
pub struct SubStreamContract;

#[contractimpl]
impl SubStreamContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn create_sub(
        env: Env,
        subscriber: Address,
        provider: Address,
        amount: i128,
        interval_sec: u64,
        sub_id: u32,
    ) {
        subscriber.require_auth();
        
        let key = DataKey::Sub(sub_id);
        if env.storage().persistent().has(&key) {
            panic!("Subscription ID already exists");
        }

        let subscription = Subscription {
            subscriber: subscriber.clone(),
            provider: provider.clone(),
            amount,
            interval_sec,
            last_payment: env.ledger().timestamp(), // First payment effectively now
        };

        env.storage().persistent().set(&key, &subscription);
        env.events().publish(("sub_created", sub_id), subscription);
    }

    pub fn execute_payment(env: Env, sub_id: u32) {
        let key = DataKey::Sub(sub_id);
        let mut sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Subscription not found");

        let current_time = env.ledger().timestamp();
        if current_time < sub.last_payment + sub.interval_sec {
            panic!("Interval not yet passed");
        }

        // In a full implementation, this would use token client to transfer funds:
        // token::Client::new(&env, &token_address).transfer(&sub.subscriber, &sub.provider, &sub.amount);
        
        sub.last_payment = current_time;
        env.storage().persistent().set(&key, &sub);
        
        env.events().publish(("payment_executed", sub_id), current_time);
    }

    pub fn cancel_sub(env: Env, sub_id: u32) {
        let key = DataKey::Sub(sub_id);
        let sub: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Subscription not found");

        sub.subscriber.require_auth();
        env.storage().persistent().remove(&key);
        
        env.events().publish(("sub_cancelled", sub_id), sub.subscriber);
    }
}

mod test;
