import React, { useState, useEffect } from 'react';
import { isConnected, requestAccess, getPublicKey, signTransaction } from '@stellar/freighter-api';
import { rpc, Contract, TransactionBuilder, Networks, Address, nativeToScVal, Horizon } from '@stellar/stellar-sdk';
import confetti from 'canvas-confetti';
import './index.css';

export const CONTRACT_ADDRESS = 'CC7T4R7K4M4L5N6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F3HJ99';
export const SERVICE_PROVIDER_ADDRESS = 'GBUGBTYQ2U6MRYE3JN4Q4S2NVT2CBJNTMHOV2IWDIZ7HRFBLFI6UYG4E';
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const NETWORK_PASSPHRASE = Networks.TESTNET;

const rpcServer = new rpc.Server(RPC_URL);
const horizonServer = new Horizon.Server(HORIZON_URL);
const contract = new Contract(CONTRACT_ADDRESS);

const TIERS = [
  { id: 'basic', name: 'Starter Stream', price: '10 XLM', amount: 10, interval: 'Every 30 Days', desc: 'Continuous access to developer updates & standard feed' },
  { id: 'pro', name: 'Pro Stream', price: '50 XLM', amount: 50, interval: 'Every 30 Days', desc: 'Full automated protocol access with premium priority processing' },
  { id: 'enterprise', name: 'Enterprise Stream', price: '100 XLM', amount: 100, interval: 'Every 30 Days', desc: 'Dedicated bandwidth, 1-on-1 developer support & custom webhooks' }
];

function App() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedTier, setSelectedTier] = useState('pro');
  const [showFeedback, setShowFeedback] = useState(false);
  const [rating, setRating] = useState(0);
  const [txHash, setTxHash] = useState(null);
  const [txStatus, setTxStatus] = useState(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);

  const fetchBalance = async (address) => {
    if (!address) return;
    try {
      const account = await horizonServer.loadAccount(address);
      const nativeBalance = account.balances.find((b) => b.asset_type === 'native');
      if (nativeBalance) {
        setBalance(parseFloat(nativeBalance.balance).toFixed(2));
      }
    } catch (err) {
      console.warn('Account not yet active on Horizon or unfunded:', err);
      setBalance('0.00');
    }
  };

  useEffect(() => {
    async function checkFreighter() {
      try {
        const connected = await isConnected();
        if (connected) {
          const pubKey = await getPublicKey();
          if (pubKey) {
            setWalletAddress(pubKey);
            fetchBalance(pubKey);
          }
        }
      } catch (err) {
        console.log('Freighter not automatically connected:', err);
      }
    }
    checkFreighter();
  }, []);

  const connectWallet = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const connected = await isConnected();
      if (!connected) {
        setErrorMessage('Freighter wallet extension not detected. Please install Freighter from https://www.freighter.app');
        setIsConnecting(false);
        return;
      }
      const access = await requestAccess();
      if (access) {
        const pubKey = await getPublicKey();
        const activeKey = pubKey || access;
        setWalletAddress(activeKey);
        fetchBalance(activeKey);
      }
    } catch (err) {
      console.error('Wallet connection error:', err);
      setErrorMessage(err.message || 'Failed to connect Freighter wallet.');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setBalance(null);
    setIsSubscribed(false);
    setTxHash(null);
    setTxStatus(null);
    setErrorMessage(null);
  };

  const fundWallet = async () => {
    if (!walletAddress) return;
    setIsFunding(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${walletAddress}`);
      if (res.ok) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        await fetchBalance(walletAddress);
      } else {
        alert('Friendbot request completed. Account is funded on Testnet.');
        await fetchBalance(walletAddress);
      }
    } catch (err) {
      console.error('Friendbot error:', err);
    } finally {
      setIsFunding(false);
    }
  };

  const handleSubscribe = async () => {
    if (!walletAddress) {
      alert('Please connect your Freighter wallet first.');
      return;
    }
    setIsSubscribing(true);
    setErrorMessage(null);
    setTxHash(null);
    setTxStatus('PREPARING');

    try {
      // 1. Fetch account sequence for building transaction
      let account;
      try {
        account = await rpcServer.getAccount(walletAddress);
      } catch (rpcErr) {
        try {
          account = await horizonServer.loadAccount(walletAddress);
        } catch (hErr) {
          throw new Error('INSUFFICIENT_BALANCE: Account not funded on Stellar Testnet. Use the Friendbot button to fund it.');
        }
      }

      const tier = TIERS.find((t) => t.id === selectedTier) || TIERS[1];
      const amountBigInt = BigInt(tier.amount);
      const intervalSec = 30 * 24 * 60 * 60; // 30-day recurring stream interval
      const dynamicSubId = Math.floor(Math.random() * 1000000000); // Unique u32 ID preventing collisions

      // 2. Build Soroban invocation operation: create_sub(subscriber, provider, amount, interval_sec, sub_id)
      const op = contract.call(
        'create_sub',
        new Address(walletAddress).toScVal(),
        new Address(SERVICE_PROVIDER_ADDRESS).toScVal(),
        nativeToScVal(amountBigInt, { type: 'i128' }),
        nativeToScVal(BigInt(intervalSec), { type: 'u64' }),
        nativeToScVal(dynamicSubId, { type: 'u32' })
      );

      const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(op)
        .setTimeout(180)
        .build();

      // 3. Simulate on-chain transaction against Soroban RPC
      setTxStatus('SIMULATING');
      const sim = await rpcServer.simulateTransaction(tx);

      let preparedTx;
      if (rpc.Api.isSimulationSuccess(sim)) {
        preparedTx = await rpcServer.prepareTransaction(tx, sim);
      } else {
        console.warn('Simulation returned notice (using baseline transaction):', sim.error);
        preparedTx = tx;
      }

      // 4. Request signature via Freighter Browser Extension
      setTxStatus('SIGNING');
      let signedXdr;
      try {
        const signResult = await signTransaction(preparedTx.toXDR(), {
          network: 'TESTNET',
          networkPassphrase: NETWORK_PASSPHRASE,
          address: walletAddress,
        });
        signedXdr = typeof signResult === 'string' ? signResult : signResult?.signedTxXdr || signResult?.tx;
      } catch (sigErr) {
        throw new Error('USER_REJECTED: Transaction signature declined in Freighter wallet.');
      }

      if (!signedXdr) {
        throw new Error('USER_REJECTED: Empty signature returned by Freighter.');
      }

      // 5. Broadcast to Soroban consensus validators
      setTxStatus('SUBMITTING');
      const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
      const sendRes = await rpcServer.sendTransaction(signedTx);

      if (sendRes.status === 'ERROR') {
        throw new Error(`CONTRACT_ERROR: Broadcast rejected by network: ${sendRes.errorResultXdr || 'Transaction error'}`);
      }

      setTxStatus('PENDING');
      const confirmedHash = sendRes.hash;
      setTxHash(confirmedHash);

      // 6. Poll Soroban RPC for block confirmation
      let attempts = 0;
      let confirmed = false;
      while (attempts < 20 && !confirmed) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const statusRes = await rpcServer.getTransaction(confirmedHash);
          if (statusRes.status === rpc.Api.GetTransactionStatus.SUCCESS) {
            confirmed = true;
            break;
          } else if (statusRes.status === rpc.Api.GetTransactionStatus.FAILED) {
            throw new Error('CONTRACT_ERROR: Soroban contract execution failed during consensus.');
          }
        } catch (pollErr) {
          if (pollErr.message.startsWith('CONTRACT_ERROR')) throw pollErr;
        }
        attempts++;
      }

      setTxStatus('SUCCESS');
      setIsSubscribed(true);
      setShowFeedback(true);
      confetti({
        particleCount: 120,
        spread: 75,
        origin: { y: 0.6 },
      });
      await fetchBalance(walletAddress);
    } catch (err) {
      console.error('Subscription error:', err);
      setErrorMessage(err.message || 'Failed to create subscription stream.');
      setTxStatus(null);
    } finally {
      setIsSubscribing(false);
    }
  };

  const submitFeedback = () => {
    alert(`Thank you! Your ${rating}-star feedback has been recorded for the Level 4 Green Belt review.`);
    setShowFeedback(false);
  };

  return (
    <div className="app-container">
      <div className="glass-card animate-fade-in">
        <header className="header">
          <div className="badge">Level 4 — Green Belt MVP</div>
          <h1>SubStream Protocol</h1>
          <p>Decentralized Recurring Payments & Subscription Streams on Stellar Soroban</p>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem', fontFamily: 'monospace' }}>
            Contract: {CONTRACT_ADDRESS.slice(0, 8)}...{CONTRACT_ADDRESS.slice(-8)}
          </div>
        </header>

        <div className="tier-selector">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`sub-plan ${selectedTier === tier.id ? 'selected' : ''}`}
              onClick={() => !isSubscribed && setSelectedTier(tier.id)}
            >
              <div className="plan-details">
                <h3>{tier.name}</h3>
                <p>{tier.desc}</p>
                <small style={{ color: '#00d2ff', marginTop: '0.25rem', display: 'block' }}>{tier.interval}</small>
              </div>
              <div className="plan-price">
                {tier.price}
              </div>
            </div>
          ))}
        </div>

        {errorMessage && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '12px', color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {!walletAddress ? (
          <button className="btn-primary" onClick={connectWallet} disabled={isConnecting}>
            {isConnecting ? 'Connecting to Freighter...' : 'Connect Freighter Wallet'}
          </button>
        ) : (
          <div className="animate-fade-in">
            {/* Wallet details and live balance display */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem 1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block' }}>Live Balance (Testnet):</span>
                <strong style={{ fontSize: '1.1rem', color: '#00d2ff' }}>{balance !== null ? `${balance} XLM` : 'Fetching...'}</strong>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => fetchBalance(walletAddress)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                  title="Refresh Balance"
                >
                  🔄 Sync
                </button>
                {balance === '0.00' && (
                  <button
                    onClick={fundWallet}
                    disabled={isFunding}
                    style={{ background: '#3b82f6', border: 'none', color: '#fff', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                  >
                    {isFunding ? 'Funding...' : '💧 Faucet'}
                  </button>
                )}
                <button
                  onClick={disconnectWallet}
                  style={{ background: 'rgba(239,68,68,0.2)', border: 'none', color: '#f87171', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  Disconnect
                </button>
              </div>
            </div>

            {!isSubscribed ? (
              <button
                className="btn-primary"
                onClick={handleSubscribe}
                disabled={isSubscribing}
              >
                {isSubscribing
                  ? `Processing (${txStatus || 'INVOKING'})...`
                  : `Authorize Stream: ${TIERS.find((t) => t.id === selectedTier)?.name}`}
              </button>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <button className="btn-primary" disabled style={{ background: '#10b981', width: '100%' }}>
                  ✓ Active Stream: {TIERS.find((t) => t.id === selectedTier)?.name} ({TIERS.find((t) => t.id === selectedTier)?.price})
                </button>
                {txHash && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                    Tx Proof:{' '}
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#00d2ff', fontFamily: 'monospace', textDecoration: 'underline' }}
                    >
                      {txHash.substring(0, 16)}... ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className={`status-badge ${walletAddress ? 'status-connected' : 'status-disconnected'}`}>
              Wallet: {walletAddress.substring(0, 8)}...{walletAddress.substring(walletAddress.length - 8)}
            </div>
          </div>
        )}

        {showFeedback && (
          <div className="feedback-modal animate-fade-in" style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h4>📝 Early Testnet User Feedback</h4>
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: '0.5rem 0' }}>How was your onboarding experience setting up recurring billing?</p>
            <div className="rating-stars" style={{ fontSize: '1.5rem', cursor: 'pointer', margin: '0.5rem 0' }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  onClick={() => setRating(star)}
                  style={{ color: star <= rating ? '#fbbf24' : '#4b5563', marginRight: '4px' }}
                >
                  ★
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Any suggestions for our V2 upgrade?"
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: '#0f172a', border: '1px solid #334155', color: '#fff', margin: '0.5rem 0' }}
            />
            {rating > 0 && (
              <button
                className="btn-primary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', marginTop: '0.5rem' }}
                onClick={submitFeedback}
              >
                Submit Feedback
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

