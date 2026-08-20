#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

#[test]
fn test_create_and_execute_sub() {
    let env = Env::default();
    let contract_id = env.register(SubStreamContract, ());
    let client = SubStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let sub_id: u32 = 1;
    let amount: i128 = 500;
    let interval: u64 = 86400; // 1 day

    // Subscriber authenticates and creates a subscription
    env.mock_all_auths();
    client.create_sub(&subscriber, &provider, &amount, &interval, &sub_id);

    // Time travel forward by 1 day and 1 second to allow execution
    env.ledger().set_timestamp(env.ledger().timestamp() + 86401);

    // Execute the payment
    client.execute_payment(&sub_id);
}

#[test]
#[should_panic(expected = "Interval not yet passed")]
fn test_execute_too_early() {
    let env = Env::default();
    let contract_id = env.register(SubStreamContract, ());
    let client = SubStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    
    env.mock_all_auths();
    client.create_sub(&subscriber, &provider, &500, &86400, &1);

    // Try to execute immediately without time traveling
    client.execute_payment(&1);
}

#[test]
fn test_cancel_subscription() {
    let env = Env::default();
    let contract_id = env.register(SubStreamContract, ());
    let client = SubStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    
    env.mock_all_auths();
    client.create_sub(&subscriber, &provider, &500, &86400, &1);

    client.cancel_sub(&1);
}

#[test]
#[should_panic(expected = "Subscription ID already exists")]
fn test_duplicate_sub_id_rejection() {
    let env = Env::default();
    let contract_id = env.register(SubStreamContract, ());
    let client = SubStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    
    env.mock_all_auths();
    client.create_sub(&subscriber, &provider, &500, &86400, &1);
    // Attempting to create another stream with the same sub_id must panic
    client.create_sub(&subscriber, &provider, &500, &86400, &1);
}

#[test]
#[should_panic(expected = "Subscription not found")]
fn test_nonexistent_sub_execution_rejection() {
    let env = Env::default();
    let contract_id = env.register(SubStreamContract, ());
    let client = SubStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Attempting to execute an uncreated sub_id must panic
    client.execute_payment(&999);
}
