// Ballot-validity circuit for slop.computer private voting.
//
// Proves in zero-knowledge that a submitted BFV ciphertext (ct0is, ct1is)
// is a valid encryption of a plaintext k1 that is a VALID ONE-HOT VOTE -
// every coefficient is 0 or Q_MOD_T_CENTERED (=1 vote), and exactly one
// is nonzero. This rejects a hostile ballot like [500,0], [2,0], or a
// multi-option stuff - closing the tally-inflation hole - while revealing
// nothing about which option was chosen.
//
// Greco encryption check (ct0/ct1) is in-circuit (no recursion) so this is
// a single proof, verifiable by one on-chain HonkVerifier. Params come
// from lib::configs::default::threshold = insecure-512 = slop's BFV preset.
use lib::configs::default::threshold::{
    L, N, Q_MOD_T_CENTERED, USER_DATA_ENCRYPTION_BIT_CT, USER_DATA_ENCRYPTION_BIT_E0,
    USER_DATA_ENCRYPTION_BIT_E1, USER_DATA_ENCRYPTION_BIT_K, USER_DATA_ENCRYPTION_BIT_P1,
    USER_DATA_ENCRYPTION_BIT_P2, USER_DATA_ENCRYPTION_BIT_PK, USER_DATA_ENCRYPTION_BIT_R1,
    USER_DATA_ENCRYPTION_BIT_R2, USER_DATA_ENCRYPTION_BIT_U, USER_DATA_ENCRYPTION_CT0_CONFIGS,
    USER_DATA_ENCRYPTION_CT1_CONFIGS,
};
use lib::core::threshold::user_data_encryption_ct0::UserDataEncryptionCt0;
use lib::core::threshold::user_data_encryption_ct1::UserDataEncryptionCt1;
use lib::math::polynomial::Polynomial;

fn main(
    // ct0 component (carries the message k1)
    pk0is: [Polynomial<N>; L],
    ct0is: [Polynomial<N>; L],
    u: Polynomial<N>,
    e0: Polynomial<N>,
    e0is: [Polynomial<N>; L],
    e0_quotients: [Polynomial<N>; L],
    k1: Polynomial<N>,
    r1is: [Polynomial<(2 * N) - 1>; L],
    r2is: [Polynomial<N - 1>; L],
    // ct1 component (shares randomness u)
    pk1is: [Polynomial<N>; L],
    ct1is: [Polynomial<N>; L],
    e1: Polynomial<N>,
    p1is: [Polynomial<(2 * N) - 1>; L],
    p2is: [Polynomial<N - 1>; L],
) -> pub (Field, Field) {
    // 1. Greco: (ct0is, ct1is) is a valid BFV encryption of k1.
    let c0: UserDataEncryptionCt0<N, L, USER_DATA_ENCRYPTION_BIT_PK, USER_DATA_ENCRYPTION_BIT_CT, USER_DATA_ENCRYPTION_BIT_U, USER_DATA_ENCRYPTION_BIT_E0, USER_DATA_ENCRYPTION_BIT_K, USER_DATA_ENCRYPTION_BIT_R1, USER_DATA_ENCRYPTION_BIT_R2> = UserDataEncryptionCt0::new(
        USER_DATA_ENCRYPTION_CT0_CONFIGS, pk0is, ct0is, u, e0, e0is, e0_quotients, k1, r1is, r2is,
    );
    let (_pk0c, ct0c, _k1c, u0c) = c0.execute();

    let c1: UserDataEncryptionCt1<N, L, USER_DATA_ENCRYPTION_BIT_PK, USER_DATA_ENCRYPTION_BIT_CT, USER_DATA_ENCRYPTION_BIT_U, USER_DATA_ENCRYPTION_BIT_E1, USER_DATA_ENCRYPTION_BIT_P1, USER_DATA_ENCRYPTION_BIT_P2> = UserDataEncryptionCt1::new(
        USER_DATA_ENCRYPTION_CT1_CONFIGS, pk1is, ct1is, u, e1, p1is, p2is,
    );
    let (_pk1c, ct1c, u1c) = c1.execute();

    // both components must share the same encryption randomness u
    assert(u0c == u1c);

    // 2. One-hot validity on k1: each coeff in {0, ONE}, exactly one nonzero.
    let one = Q_MOD_T_CENTERED;
    let mut nonzero: Field = 0;
    for i in 0..N {
        let c = k1.coefficients[i];
        assert(c * (c - one) == 0); // c == 0 or c == ONE
        nonzero += (c != 0) as Field;
    }
    assert(nonzero == 1); // exactly one vote

    // public outputs bind the proof to the submitted ciphertext components
    (ct0c, ct1c)
}
