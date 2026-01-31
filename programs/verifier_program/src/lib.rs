use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    ed25519_program,
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
    instruction::Instruction,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar,
};

entrypoint!(process_instruction);

#[derive(BorshSerialize, BorshDeserialize, Debug, Default, Clone)]
pub struct VerifiedVoteState {
    pub proposal_id: u64,
    pub yes_proofs: u64,
}

const ATTESTATION_SIGNER_PUBKEY: [u8; 32] = [
    0x16, 0x93, 0x5c, 0xb5, 0x14, 0x21, 0xe6, 0x4f, 0x44, 0xb2, 0xac, 0xe1, 0x4b, 0xa2,
    0xe6, 0x90, 0x1d, 0xe0, 0x0d, 0x92, 0xcb, 0x1e, 0xe3, 0xca, 0x69, 0x47, 0x3d, 0x75,
    0x02, 0xab, 0xdb, 0x8d,
];

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let min_len = 8 + 8 + 32 + 32 + 64 + 4;
    if instruction_data.len() < min_len {
        msg!("Invalid instruction data length");
        return Err(ProgramError::InvalidInstructionData);
    }

    let expected_program_id = u64::from_le_bytes(
        instruction_data[0..8]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let proposal_id = u64::from_le_bytes(
        instruction_data[8..16]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let vk_hash = &instruction_data[16..48];
    let public_inputs_hash = &instruction_data[48..80];
    let signature = &instruction_data[80..144];
    let proof_len = u32::from_le_bytes(
        instruction_data[144..148]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ) as usize;
    if instruction_data.len() < 148 + proof_len {
        msg!("Invalid proof length");
        return Err(ProgramError::InvalidInstructionData);
    }
    let proof = &instruction_data[148..148 + proof_len];

    let proof_hash = hashv(&[proof]).to_bytes();
    let message_hash = hashv(&[
        b"VEILPROOF_V1",
        &expected_program_id.to_le_bytes(),
        &proposal_id.to_le_bytes(),
        vk_hash,
        &proof_hash,
        public_inputs_hash,
    ])
    .to_bytes();

    let account_info_iter = &mut accounts.iter();
    let state_account = next_account_info(account_info_iter)?;
    let instructions_sysvar = next_account_info(account_info_iter)?;

    if instructions_sysvar.key != &sysvar::instructions::id() {
        msg!("Missing instruction sysvar");
        return Err(ProgramError::InvalidAccountData);
    }

    if !verify_ed25519_instruction(
        instructions_sysvar,
        &ATTESTATION_SIGNER_PUBKEY,
        signature,
        &message_hash,
    ) {
        msg!("Attestation signature verification failed");
        return Err(ProgramError::InvalidInstructionData);
    }

    if !state_account.is_writable {
        msg!("State account must be writable");
        return Err(ProgramError::InvalidAccountData);
    }

    let mut state = if state_account.data_is_empty() {
        VerifiedVoteState {
            proposal_id,
            yes_proofs: 0,
        }
    } else {
        VerifiedVoteState::try_from_slice(&state_account.data.borrow())
            .map_err(|_| ProgramError::InvalidAccountData)?
    };

    if state.proposal_id == 0 {
        state.proposal_id = proposal_id;
    }
    if state.proposal_id != proposal_id {
        msg!("Proposal ID mismatch");
        return Err(ProgramError::InvalidInstructionData);
    }

    state.yes_proofs = state.yes_proofs.saturating_add(1);
    state
        .serialize(&mut &mut state_account.data.borrow_mut()[..])
        .map_err(|_| ProgramError::InvalidAccountData)?;

    msg!("Verified anonymous YES proof for proposal {}", proposal_id);
    Ok(())
}

fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &[u8; 32],
    expected_signature: &[u8],
    expected_message: &[u8; 32],
) -> bool {
    let current_index = match sysvar::instructions::load_current_index_checked(instructions_sysvar) {
        Ok(index) => index,
        Err(_) => return false,
    };

    for i in 0..current_index {
        let ix: Instruction =
            match sysvar::instructions::load_instruction_at_checked(i as usize, instructions_sysvar)
            {
                Ok(ix) => ix,
                Err(_) => return false,
            };
        if ix.program_id != ed25519_program::id() {
            continue;
        }

        if check_ed25519_ix(&ix, expected_pubkey, expected_signature, expected_message) {
            return true;
        }
    }

    false
}

fn check_ed25519_ix(
    ix: &Instruction,
    expected_pubkey: &[u8; 32],
    expected_signature: &[u8],
    expected_message: &[u8; 32],
) -> bool {
    if ix.data.len() < 2 {
        return false;
    }
    let num_signatures = ix.data[0] as usize;
    if num_signatures != 1 {
        return false;
    }
    let offsets_start = 2;
    if ix.data.len() < offsets_start + 14 {
        return false;
    }

    let sig_offset = u16::from_le_bytes([ix.data[2], ix.data[3]]) as usize;
    let sig_ix_index = u16::from_le_bytes([ix.data[4], ix.data[5]]);
    let pub_offset = u16::from_le_bytes([ix.data[6], ix.data[7]]) as usize;
    let pub_ix_index = u16::from_le_bytes([ix.data[8], ix.data[9]]);
    let msg_offset = u16::from_le_bytes([ix.data[10], ix.data[11]]) as usize;
    let msg_size = u16::from_le_bytes([ix.data[12], ix.data[13]]) as usize;
    let msg_ix_index = u16::from_le_bytes([ix.data[14], ix.data[15]]);

    if sig_ix_index != u16::MAX || pub_ix_index != u16::MAX || msg_ix_index != u16::MAX {
        return false;
    }

    if ix.data.len() < sig_offset + 64 || ix.data.len() < pub_offset + 32 {
        return false;
    }
    if ix.data.len() < msg_offset + msg_size || msg_size != 32 {
        return false;
    }

    let sig = &ix.data[sig_offset..sig_offset + 64];
    let pubkey = &ix.data[pub_offset..pub_offset + 32];
    let message = &ix.data[msg_offset..msg_offset + msg_size];

    sig == expected_signature
        && pubkey == expected_pubkey
        && message == expected_message
}
