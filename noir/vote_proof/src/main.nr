fn main(
    program_id: u64,
    proposal_id: u64,
    vote_choice: u8,
    expected_program_id: pub u64,
    expected_proposal_id: pub u64,
) {
    assert(program_id == expected_program_id);
    assert(proposal_id == expected_proposal_id);
    assert(vote_choice == 1);
}
