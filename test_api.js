const testApi = async () => {
  const baseUrl = 'http://localhost:5000/api';
  console.log('--- Starting API Integration Tests ---');

  try {
    // 1. Create a Booking Request
    console.log('\n1. Submitting a new booking enquiry...');
    const bookingPayload = {
      name: 'John Doe',
      phone: '9876543210',
      email: 'johndoe@gmail.com',
      age: 25,
      address: 'Mumbai, India',
      education: 'ITI / Diploma',
      currentStatus: 'Working - Want overseas job',
      skills: 'Welding',
      services: 'career,visa',
      careerIndustry: 'Skilled Trades — Welding',
      careerJobTitle: 'Welding — Pipe Welding',
      preferredCountry: 'UAE / Dubai',
      passport: 'Yes - Valid passport',
      overseasExp: 'No - First time',
      notes: 'Testing real-time APIs',
      amount: 500
    };

    const createRes = await fetch(`${baseUrl}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bookingPayload)
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create booking: ${await createRes.text()}`);
    }

    const booking = await createRes.json();
    console.log(`Success: Booking created with ID: ${booking._id}, status: ${booking.status}, paymentStatus: ${booking.paymentStatus}`);

    // 2. Confirm Payment
    console.log('\n2. Simulating Razorpay payment completion...');
    const payRes = await fetch(`${baseUrl}/bookings/${booking._id}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ paymentId: 'pay_test_123456789' })
    });

    if (!payRes.ok) {
      throw new Error(`Failed to confirm payment: ${await payRes.text()}`);
    }

    const payData = await payRes.json();
    console.log(`Success: Payment confirmed, paymentStatus is now: ${payData.booking.paymentStatus}, paymentId: ${payData.booking.paymentId}`);

    // 3. Admin Login
    console.log('\n3. Logging in as admin...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@gmail.com',
        password: 'Admin@123'
      })
    });

    if (!loginRes.ok) {
      throw new Error(`Admin login failed: ${await loginRes.text()}`);
    }

    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log(`Success: Admin authenticated! Received token.`);

    // 4. Fetch all bookings (Admin protected)
    console.log('\n4. Fetching bookings list as admin...');
    const fetchRes = await fetch(`${baseUrl}/bookings`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch bookings: ${await fetchRes.text()}`);
    }

    const bookings = await fetchRes.json();
    console.log(`Success: Fetched ${bookings.length} bookings. Latest booking candidate: ${bookings[0].name}`);

    // 5. Update Booking Status (Admin protected)
    console.log('\n5. Updating booking call status...');
    const updateRes = await fetch(`${baseUrl}/bookings/${booking._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        status: 'Processing',
        counselorNotes: 'Candidate is eligible for subclass 482 visa. Scheduled call.'
      })
    });

    if (!updateRes.ok) {
      throw new Error(`Failed to update booking: ${await updateRes.text()}`);
    }

    const updatedBooking = await updateRes.json();
    console.log(`Success: Booking status updated to: ${updatedBooking.status}, notes: "${updatedBooking.counselorNotes}"`);
    console.log('\n--- All API Integration Tests Passed Successfully! ---');
    process.exit(0);

  } catch (error) {
    console.error('Test Failed:', error.message);
    process.exit(1);
  }
};

testApi();
