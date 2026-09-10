/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/kubrai.json`.
 */
export type Kubrai = {
  "address": "F9qowxW3hmwrzDeKQXpL4rVmFcPvWe7e43oGnWU3AvQb",
  "metadata": {
    "name": "kubrai",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "createMarket",
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config.marketCount",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "marketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "finalizeResolution",
      "docs": [
        "Anyone after the dispute window; admin immediately."
      ],
      "discriminator": [
        191,
        74,
        94,
        214,
        45,
        150,
        152,
        125
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "treasury"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "placeBet",
      "discriminator": [
        222,
        62,
        67,
        220,
        63,
        166,
        126,
        33
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "userToken",
          "writable": true
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeResolution",
      "docs": [
        "Proposer publishes the outcome plus the hash of the snapshot bundle it",
        "derived it from. Starts the dispute window."
      ],
      "discriminator": [
        19,
        68,
        181,
        23,
        194,
        146,
        152,
        252
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "proposer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "observedValue",
          "type": "i64"
        },
        {
          "name": "snapshotHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "seedMarket",
      "docs": [
        "Anyone (normally the treasury) adds a fee-free prize to the pot."
      ],
      "discriminator": [
        135,
        168,
        23,
        193,
        22,
        158,
        18,
        232
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "funderToken",
          "writable": true
        },
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settlePosition",
      "docs": [
        "Permissionless payout + close. Winners are paid, losers just get their",
        "rent back. Works for Resolved and Voided markets."
      ],
      "discriminator": [
        33,
        156,
        74,
        218,
        215,
        42,
        112,
        175
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "sweepMarket",
      "docs": [
        "After every position is settled: fees + rounding dust (+ seed if voided or",
        "no winners) go to treasury, vault is closed."
      ],
      "discriminator": [
        108,
        51,
        86,
        64,
        135,
        30,
        91,
        243
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "rentDest",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        },
        {
          "name": "newAdmin",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "voidMarket",
      "docs": [
        "Admin escape hatch: every position is refunded in full, seed goes back to treasury."
      ],
      "discriminator": [
        243,
        175,
        46,
        124,
        95,
        101,
        39,
        69
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "events": [
    {
      "name": "betPlaced",
      "discriminator": [
        88,
        88,
        145,
        226,
        126,
        206,
        32,
        0
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "positionSettled",
      "discriminator": [
        75,
        100,
        92,
        189,
        245,
        116,
        252,
        221
      ]
    },
    {
      "name": "resolutionProposed",
      "discriminator": [
        209,
        21,
        193,
        193,
        218,
        234,
        131,
        108
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "feeTooHigh",
      "msg": "fee above hard ceiling"
    },
    {
      "code": 6002,
      "name": "badSchedule",
      "msg": "bad schedule"
    },
    {
      "code": 6003,
      "name": "zeroAmount",
      "msg": "amount must be > 0"
    },
    {
      "code": 6004,
      "name": "belowMinBet",
      "msg": "below minimum bet"
    },
    {
      "code": 6005,
      "name": "marketNotOpen",
      "msg": "market is not open"
    },
    {
      "code": 6006,
      "name": "bettingNotStarted",
      "msg": "betting has not started"
    },
    {
      "code": 6007,
      "name": "bettingClosed",
      "msg": "betting is closed"
    },
    {
      "code": 6008,
      "name": "paused",
      "msg": "protocol paused"
    },
    {
      "code": 6009,
      "name": "tooEarlyToResolve",
      "msg": "too early to resolve"
    },
    {
      "code": 6010,
      "name": "notProposed",
      "msg": "no resolution proposed"
    },
    {
      "code": 6011,
      "name": "disputeWindowOpen",
      "msg": "dispute window still open"
    },
    {
      "code": 6012,
      "name": "alreadyFinal",
      "msg": "market already final"
    },
    {
      "code": 6013,
      "name": "notResolved",
      "msg": "market not resolved"
    },
    {
      "code": 6014,
      "name": "positionsOutstanding",
      "msg": "positions still outstanding"
    }
  ],
  "types": [
    {
      "name": "betPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "poolYes",
            "type": "u64"
          },
          {
            "name": "poolNo",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "earlyBirdDiscountBps",
            "type": "u16"
          },
          {
            "name": "earlyBirdSecs",
            "type": "i64"
          },
          {
            "name": "disputeWindowSecs",
            "type": "i64"
          },
          {
            "name": "minBet",
            "type": "u64"
          },
          {
            "name": "marketCount",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "earlyBirdDiscountBps",
            "type": "u16"
          },
          {
            "name": "earlyBirdSecs",
            "type": "i64"
          },
          {
            "name": "disputeWindowSecs",
            "type": "i64"
          },
          {
            "name": "minBet",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "metric",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "questionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "threshold",
            "type": "i64"
          },
          {
            "name": "openTs",
            "type": "i64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "resolveAfterTs",
            "type": "i64"
          },
          {
            "name": "poolYes",
            "type": "u64"
          },
          {
            "name": "poolNo",
            "type": "u64"
          },
          {
            "name": "seedAmount",
            "type": "u64"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "proposedOutcome",
            "type": "u8"
          },
          {
            "name": "proposedValue",
            "type": "i64"
          },
          {
            "name": "proposedAt",
            "type": "i64"
          },
          {
            "name": "snapshotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "feeCollected",
            "type": "u64"
          },
          {
            "name": "paidOut",
            "type": "u64"
          },
          {
            "name": "swept",
            "type": "u64"
          },
          {
            "name": "positions",
            "type": "u32"
          },
          {
            "name": "positionsOpen",
            "type": "u32"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "metric",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "questionHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "threshold",
            "type": "i64"
          },
          {
            "name": "openTs",
            "type": "i64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "resolveAfterTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "metric",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "threshold",
            "type": "i64"
          },
          {
            "name": "openTs",
            "type": "i64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "voided",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "yesAmount",
            "type": "u64"
          },
          {
            "name": "noAmount",
            "type": "u64"
          },
          {
            "name": "yesFeeW",
            "type": "u128"
          },
          {
            "name": "noFeeW",
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "positionSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "resolutionProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "observedValue",
            "type": "i64"
          },
          {
            "name": "snapshotHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proposedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    }
  ]
};
