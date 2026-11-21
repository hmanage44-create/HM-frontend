/**
 * StayFlow Centralized Razorpay Payment Gateway Utility
 * Loads the official Razorpay Checkout SDK and provides shared payment helpers
 * across all modules (Front Desk, Restaurant POS, Finance, Reservations, Amenities).
 */

export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const existingScript = document.getElementById('razorpay-checkout-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('Failed to load Razorpay Checkout script from CDN.');
      resolve(false);
    };
    document.body.appendChild(script);
  });
}

/**
 * Shared Razorpay Checkout Launcher
 * Opens the official Razorpay Checkout dialog and handles success/failure/dismissal.
 */
export async function openRazorpayCheckout({
  keyId,
  orderId,
  amount, // in INR or paise
  amountInPaise, // optional explicit paise directly matching backend order
  currency = 'INR',
  name = 'StayFlow Hotel Management',
  description = 'Online Payment Settlement',
  prefill = {},
  notes = {},
  onSuccess,
  onFailure,
  onDismiss,
}) {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Unable to load Razorpay payment gateway SDK. Please check your internet connection.');
  }

  // Exactly-once paise calculation:
  // If amountInPaise is provided explicitly from the order, use it directly (never multiply again!).
  // Otherwise, convert INR to paise.
  let finalAmountInPaise;
  if (amountInPaise != null && Number(amountInPaise) > 0) {
    finalAmountInPaise = Math.round(Number(amountInPaise));
  } else if (amount != null && Number(amount) > 0) {
    finalAmountInPaise = Math.round(Number(amount) * 100);
  } else {
    finalAmountInPaise = 0;
  }

  const options = {
    key: keyId || 'rzp_test_stayflow',
    amount: finalAmountInPaise,
    currency: currency || 'INR',
    name: name || 'StayFlow Hotel Management',
    description: description || 'Payment Settlement',
    order_id: orderId,
    prefill: {
      name: prefill.name || '',
      email: prefill.email || '',
      contact: prefill.contact || prefill.phone || '',
    },
    notes: notes || {},
    theme: {
      color: '#0F172A',
    },
    handler: function (response) {
      // response: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
      if (onSuccess) {
        onSuccess(response);
      }
    },
    modal: {
      ondismiss: function () {
        if (onDismiss) {
          onDismiss();
        }
      },
    },
  };

  const rzp = new window.Razorpay(options);

  rzp.on('payment.failed', function (response) {
    if (onFailure) {
      onFailure(response);
    }
  });

  rzp.open();
  return rzp;
}

/**
 * End-to-end Centralized Payment Processor
 * 1. Calls backend create-order API
 * 2. Launches Razorpay Checkout modal
 * 3. Verifies payment signature on backend
 * 4. Calls onSuccess / onError / onDismiss callbacks
 */
export async function executeRazorpayPayment({
  api, // api service function from '../services/api'
  orderEndpoint = '/api/payments/razorpay/create-order',
  verifyEndpoint = '/api/payments/razorpay/verify',
  failedEndpoint = '/api/payments/razorpay/failed',
  orderPayload = {},
  name = 'StayFlow Hotel Management',
  description = 'Payment Settlement',
  prefill = {},
  onSuccess,
  onError,
  onDismiss,
}) {
  try {
    // 1. Create Order via backend
    const orderRes = await api(orderEndpoint, {
      method: 'POST',
      body: JSON.stringify(orderPayload),
    });

    if (!orderRes || !orderRes.order_id) {
      throw new Error(orderRes?.detail || 'Failed to create Razorpay payment order on backend.');
    }

    const { order_id, amount, amount_inr, key_id, currency } = orderRes;

    // Resolve INR and Paise amounts safely
    const resolvedInr = amount_inr != null 
      ? Number(amount_inr) 
      : (amount ? Number(amount) / 100 : Number(orderPayload.amount || 0));
    const resolvedPaise = amount != null && Number(amount) > 0 
      ? Math.round(Number(amount)) 
      : Math.round(resolvedInr * 100);

    // 2. Open Checkout Modal
    await openRazorpayCheckout({
      keyId: key_id,
      orderId: order_id,
      amount: resolvedInr,
      amountInPaise: resolvedPaise,
      currency: currency || 'INR',
      name,
      description,
      prefill,
      notes: orderPayload.notes || {},
      onSuccess: async (response) => {
        try {
          // 3. Verify signature via backend
          const verifyPayload = {
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            booking_reference: orderPayload.booking_reference,
            record_id: orderPayload.record_id,
            module: orderPayload.module,
          };

          const verifyRes = await api(verifyEndpoint, {
            method: 'POST',
            body: JSON.stringify(verifyPayload),
          });

          if (onSuccess) {
            onSuccess(verifyRes, response);
          }
        } catch (vErr) {
          if (onError) {
            onError(new Error(`Payment verification failed: ${vErr.message || 'Signature mismatch'}`));
          }
        }
      },
      onFailure: (resp) => {
        if (failedEndpoint) {
          api(failedEndpoint, {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: order_id,
              error_code: resp?.error?.code,
              error_description: resp?.error?.description || 'Payment declined',
            }),
          }).catch(() => {});
        }
        if (onError) {
          onError(new Error(resp?.error?.description || 'Razorpay payment was declined or failed.'));
        }
      },
      onDismiss: () => {
        if (failedEndpoint) {
          api(failedEndpoint, {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: order_id,
              error_description: 'Checkout window was closed by user',
            }),
          }).catch(() => {});
        }
        if (onDismiss) {
          onDismiss();
        }
      },
    });
  } catch (err) {
    if (onError) {
      onError(err);
    } else {
      throw err;
    }
  }
}
